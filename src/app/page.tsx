'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { getDb, Receipt, ExpenseCategory } from '../lib/db';
import { Camera, X, Edit2, Loader2, Download, ChevronDown } from 'lucide-react';
import Script from 'next/script';

// OpenCV.jsの型定義
declare global {
    interface Window {
        cv: {
            Mat: any & {
                zeros: (rows: number, cols: number, type: number) => any;
            };
            MatVector: new () => any;
            Point: any;
            Point2f: any;
            getPerspectiveTransform: (src: any, dst: any) => any;
            getRotationMatrix2D: (center: any, angle: number, scale: number) => any;
            warpPerspective: (src: any, dst: any, M: any, dsize: any, flags?: number, borderMode?: number, borderValue?: any) => void;
            warpAffine: (src: any, dst: any, M: any, dsize: any, flags?: number, borderMode?: number, borderValue?: any) => void;
            imread: (canvasId: string | HTMLCanvasElement) => any;
            imshow: (canvasId: string | HTMLCanvasElement, mat: any) => void;
            matFromArray: (rows: number, cols: number, type: number, array: number[]) => any;
            CV_8UC4: number;
            CV_8UC1: number;
            CV_32FC2: number;
            CV_32SC2: number;
            INTER_LINEAR: number;
            INTER_CUBIC: number;
            BORDER_CONSTANT: number;
            COLOR_RGBA2GRAY: number;
            COLOR_RGBA2HSV: number;
            COLOR_HSV2RGBA: number;
            RETR_EXTERNAL: number;
            RETR_TREE: number;
            RETR_LIST: number;
            CHAIN_APPROX_SIMPLE: number;
            ADAPTIVE_THRESH_GAUSSIAN_C: number;
            THRESH_BINARY: number;
            THRESH_OTSU: number;
            MORPH_RECT: number;
            MORPH_CLOSE: number;
            MORPH_OPEN: number;
            adaptiveThreshold: (src: any, dst: any, maxValue: number, adaptiveMethod: number, thresholdType: number, blockSize: number, C: number) => void;
            threshold: (src: any, dst: any, thresh: number, maxval: number, type: number) => number;
            dilate: (src: any, dst: any, kernel: any, anchor?: any, iterations?: number, borderType?: number, borderValue?: any) => void;
            morphologyEx: (src: any, dst: any, op: number, kernel: any, anchor?: any, iterations?: number, borderType?: number, borderValue?: any) => void;
            getStructuringElement: (shape: number, ksize: any) => any;
            isContourConvex: (contour: any) => boolean;
            convexHull: (points: any, hull: any, clockwise?: boolean, returnPoints?: boolean) => void;
            meanStdDev: (src: any, mean: any, stddev: any, mask?: any) => void;
            split: (src: any, dst: any) => void;
            resize: (src: any, dst: any, dsize: any, fx?: number, fy?: number, interpolation?: number) => void;
            minAreaRect: (points: any) => any;
            boxPoints: (box: any, points: any) => void;
            Size: new (width: number, height: number) => any;
            Scalar: new (...args: number[]) => any;
            cvtColor: (src: any, dst: any, code: number) => void;
            GaussianBlur: (src: any, dst: any, ksize: any, sigmaX: number) => void;
            medianBlur: (src: any, dst: any, ksize: number) => void;
            Canny: (src: any, dst: any, threshold1: number, threshold2: number) => void;
            findContours: (src: any, contours: any, hierarchy: any, mode: number, method: number) => void;
            drawContours: (image: any, contours: any, contourIdx: number, color: any, thickness: number) => void;
            contourArea: (contour: any) => number;
            arcLength: (contour: any, closed: boolean) => number;
            approxPolyDP: (curve: any, approxCurve: any, epsilon: number, closed: boolean) => void;
            onRuntimeInitialized: () => void;
        };
    }
}

export default function Home() {
    const [receipts, setReceipts] = useState<Receipt[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isOcrProcessing, setIsOcrProcessing] = useState(false);
    const [ocrWarning, setOcrWarning] = useState<string | null>(null);
    const [editingReceipt, setEditingReceipt] = useState<Receipt | null>(null);
    const [editForm, setEditForm] = useState<{
        vendor: string;
        amount: number;
        note: string;
        date: string;
        expenseCategory: ExpenseCategory;
    }>({
        vendor: '',
        amount: 0,
        note: '',
        date: '',
        expenseCategory: '雑費'
    });
    const [isOpenCvReady, setIsOpenCvReady] = useState(false);
    const [expandedImage, setExpandedImage] = useState<{ url: string; receipt: Receipt } | null>(null);
    const [sortBy, setSortBy] = useState<'timestamp' | 'receiptDate'>('receiptDate'); // ソート基準：撮影時間 or レシート日時
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest'); // 並び順：新しい順 or 古い順
    const [showExportModal, setShowExportModal] = useState(false);
    const [previewImage, setPreviewImage] = useState<{ blob: Blob; corners: Array<{ x: number; y: number }> | null } | null>(null); // プレビュー画像と検出座標
    const [visibleButtons, setVisibleButtons] = useState<Set<number>>(new Set()); // ボタンが表示されているレシートIDのセット
    const previewImageUrlRef = useRef<string | null>(null); // プレビュー画像のURL（メモリ管理用）

    // プレビュー画像のURLを管理するuseEffect
    useEffect(() => {
        if (previewImage) {
            // 新しいプレビュー画像が設定されたらURLを作成
            if (previewImageUrlRef.current) {
                URL.revokeObjectURL(previewImageUrlRef.current);
            }
            previewImageUrlRef.current = URL.createObjectURL(previewImage.blob);
            console.log('Preview image URL created:', previewImageUrlRef.current);
        } else {
            // プレビュー画像がクリアされたらURLを解放
            if (previewImageUrlRef.current) {
                URL.revokeObjectURL(previewImageUrlRef.current);
                previewImageUrlRef.current = null;
            }
        }

        return () => {
            // クリーンアップ
            if (previewImageUrlRef.current) {
                URL.revokeObjectURL(previewImageUrlRef.current);
                previewImageUrlRef.current = null;
            }
        };
    }, [previewImage]);

    // リアルタイムレシート検出用の状態
    const [detectedCorners, setDetectedCorners] = useState<Array<{ x: number; y: number }> | null>(null);
    const detectionAnimationFrameRef = useRef<number | null>(null);
    const stableDetectionStartRef = useRef<number | null>(null);
    const lastDetectedCornersRef = useRef<Array<{ x: number; y: number }> | null>(null);
    const detectionCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const stableFrameCountRef = useRef<number>(0); // 連続検出フレーム数をカウント
    const STABLE_FRAME_THRESHOLD = 10; // 10フレーム連続で安定検出されたら自動キャプチャ
    const capturePhotoRef = useRef<(() => Promise<void>) | null>(null); // capturePhoto関数への参照
    const detectedCornersRef = useRef<Array<{ x: number; y: number }> | null>(null); // detectedCornersのref版
    const cornersHistoryRef = useRef<Array<Array<{ x: number; y: number }>>>([]); // 過去5フレームのコーナー履歴
    const centroidHistoryRef = useRef<Array<{ x: number; y: number }>>([]); // 過去10フレームの重心履歴
    const debugCanvasRef = useRef<HTMLCanvasElement | null>(null); // デバッグ用の二値化画像Canvas
    const consecutiveFailuresRef = useRef<number>(0); // 連続検出失敗フレーム数

    const fileInputRef = useRef<HTMLInputElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [isCameraActive, setIsCameraActive] = useState(false);
    const imageUrlsRef = useRef<Map<number, string>>(new Map());

    const loadReceipts = useCallback(async () => {
        if (typeof window === 'undefined') {
            setIsLoading(false);
            return;
        }

        try {
            setError(null);
            const db = getDb();
            if (!db) {
                // DBが利用できない場合はスキップ
                setIsLoading(false);
                return;
            }
            const allReceipts = await db.receipts.orderBy('timestamp').reverse().toArray();
            setReceipts(allReceipts);
        } catch (err) {
            console.error('Failed to load receipts:', err);
            setError('レシートの読み込みに失敗しました');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            loadReceipts();
        } else {
            setIsLoading(false);
        }
    }, [loadReceipts]);

    // 合計金額を計算（通貨ごとに分けて）
    const totalAmountByCurrency = receipts.reduce((acc, receipt) => {
        const currency = receipt.currency || 'JPY'; // デフォルトはJPY
        if (!acc[currency]) {
            acc[currency] = 0;
        }
        acc[currency] += receipt.amount || 0;
        return acc;
    }, {} as Record<string, number>);

    // 金額をフォーマット（通貨コードに応じて、全世界対応）
    const formatAmount = (amount: number, currency?: string | null) => {
        const formattedAmount = amount.toLocaleString('ja-JP');
        // 通貨コードを大文字に変換して厳密に比較
        const normalizedCurrency = currency?.toUpperCase() || 'JPY';

        // 主要な通貨の記号マッピング
        const currencySymbols: Record<string, string> = {
            'USD': '$',
            'EUR': '€',
            'GBP': '£',
            'JPY': '¥',
            'THB': '฿',
            'CNY': '¥',
            'KRW': '₩',
            'SGD': 'S$',
            'AUD': 'A$',
            'CAD': 'C$',
            'INR': '₹',
            'HKD': 'HK$',
            'NZD': 'NZ$',
            'MXN': 'MX$',
            'PHP': '₱',
            'MYR': 'RM',
            'IDR': 'Rp',
            'VND': '₫',
            'TWD': 'NT$',
            'BRL': 'R$',
            'CHF': 'CHF',
            'SEK': 'kr',
            'NOK': 'kr',
            'DKK': 'kr',
            'PLN': 'zł',
            'CZK': 'Kč',
            'HUF': 'Ft',
            'RUB': '₽',
            'ZAR': 'R',
            'TRY': '₺',
        };

        const symbol = currencySymbols[normalizedCurrency] || normalizedCurrency;
        return `${symbol}${formattedAmount}`;
    };

    // 日付から月キーを取得（YYYY/MM形式）
    const getMonthKey = (receipt: Receipt): string => {
        // receiptDateを優先、なければdate、それもなければtimestamp
        let date: Date | null = null;

        if (receipt.receiptDate) {
            date = receipt.receiptDate;
        } else if (receipt.date) {
            // dateがYYYY/MM/DD形式の場合
            const dateParts = receipt.date.split('/');
            if (dateParts.length === 3) {
                const year = parseInt(dateParts[0], 10);
                const month = parseInt(dateParts[1], 10);
                const day = parseInt(dateParts[2], 10);
                if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
                    date = new Date(year, month - 1, day);
                }
            }
        }

        if (!date && receipt.timestamp) {
            date = receipt.timestamp instanceof Date ? receipt.timestamp : new Date(receipt.timestamp);
        }

        if (!date) {
            return 'unknown'; // 日付不明
        }

        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        return `${year}/${month}`;
    };

    // レシートのソートと月別グループ化（useMemoで最適化）
    const groupedReceipts = useMemo(() => {
        // ソート済みレシートを作成
        const sortedReceipts = [...receipts].sort((a, b) => {
            // ソート基準に応じて日付を取得
            const getDate = (receipt: Receipt): Date => {
                if (sortBy === 'receiptDate') {
                    // レシート日時でソートする場合
                    if (receipt.receiptDate) {
                        return receipt.receiptDate;
                    }
                    if (receipt.date) {
                        const dateParts = receipt.date.split('/');
                        if (dateParts.length === 3) {
                            const year = parseInt(dateParts[0], 10);
                            const month = parseInt(dateParts[1], 10);
                            const day = parseInt(dateParts[2], 10);
                            if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
                                return new Date(year, month - 1, day);
                            }
                        }
                    }
                    // receiptDateがない場合はtimestampをフォールバック
                    return receipt.timestamp instanceof Date ? receipt.timestamp : new Date(receipt.timestamp);
                } else {
                    // 撮影時間でソートする場合
                    return receipt.timestamp instanceof Date ? receipt.timestamp : new Date(receipt.timestamp);
                }
            };

            const dateA = getDate(a);
            const dateB = getDate(b);

            if (sortOrder === 'newest') {
                return dateB.getTime() - dateA.getTime(); // 降順（新しい順）
            } else {
                return dateA.getTime() - dateB.getTime(); // 昇順（古い順）
            }
        });

        // 月別にグループ化
        const grouped: Record<string, Receipt[]> = {};
        const unknownDateReceipts: Receipt[] = [];

        sortedReceipts.forEach(receipt => {
            const monthKey = getMonthKey(receipt);
            if (monthKey === 'unknown') {
                unknownDateReceipts.push(receipt);
            } else {
                if (!grouped[monthKey]) {
                    grouped[monthKey] = [];
                }
                grouped[monthKey].push(receipt);
            }
        });

        // 月キーをソート（新しい順または古い順）
        const sortedMonthKeys = Object.keys(grouped).sort((a, b) => {
            if (sortOrder === 'newest') {
                return b.localeCompare(a); // 降順（2025/12 → 2025/11 → ...）
            } else {
                return a.localeCompare(b); // 昇順（2025/01 → 2025/02 → ...）
            }
        });

        return {
            grouped,
            sortedMonthKeys,
            unknownDateReceipts
        };
    }, [receipts, sortOrder, sortBy]);

    // 月間合計金額を計算
    const getMonthlyTotal = (monthReceipts: Receipt[]): Record<string, number> => {
        return monthReceipts.reduce((acc, receipt) => {
            const currency = receipt.currency || 'JPY';
            if (!acc[currency]) {
                acc[currency] = 0;
            }
            acc[currency] += receipt.amount || 0;
            return acc;
        }, {} as Record<string, number>);
    };

    // 月名を日本語で表示
    const formatMonthName = (monthKey: string): string => {
        if (monthKey === 'unknown') {
            return '日付不明';
        }
        const [year, month] = monthKey.split('/');
        const monthNum = parseInt(month, 10);
        return `${year}年${monthNum}月`;
    };

    // CSVエクスポート機能
    const exportToCSV = (format: 'generic' | 'freee' | 'moneyforward', exportAll: boolean) => {
        // エクスポート対象のレシートを取得
        const receiptsToExport = exportAll ? receipts : groupedReceipts.sortedMonthKeys.flatMap(monthKey =>
            groupedReceipts.grouped[monthKey] || []
        ).concat(groupedReceipts.unknownDateReceipts);

        let csvContent = '';
        let filename = '';

        if (format === 'generic') {
            // 汎用CSV形式
            csvContent = generateGenericCSV(receiptsToExport);
            filename = `receipt_export_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.csv`;
        } else if (format === 'freee') {
            // freee形式
            csvContent = generateFreeeCSV(receiptsToExport);
            filename = `receipt_freee_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.csv`;
        } else if (format === 'moneyforward') {
            // マネーフォワード形式
            csvContent = generateMoneyForwardCSV(receiptsToExport);
            filename = `receipt_mf_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.csv`;
        }

        // BOM付きUTF-8でダウンロード
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        setShowExportModal(false);
    };

    // 画像エクスポート機能（ZIP形式）
    const exportImages = async (exportAll: boolean) => {
        try {
            // クライアントサイドでのみ実行
            if (typeof window === 'undefined') {
                alert('この機能はブラウザでのみ利用できます');
                return;
            }

            const receiptsToExport = exportAll ? receipts : groupedReceipts.sortedMonthKeys.flatMap(monthKey =>
                groupedReceipts.grouped[monthKey] || []
            ).concat(groupedReceipts.unknownDateReceipts);

            if (receiptsToExport.length === 0) {
                alert('エクスポートするレシートがありません');
                return;
            }

            // JSZipを動的にインポート（クライアントサイドでのみ）
            const JSZip = (await import('jszip')).default;
            const zip = new JSZip();

            // 各レシート画像をZIPに追加（元のサイズを保持）
            for (let i = 0; i < receiptsToExport.length; i++) {
                const receipt = receiptsToExport[i];
                const dateStr = receipt.receiptDate
                    ? `${receipt.receiptDate.getFullYear()}${String(receipt.receiptDate.getMonth() + 1).padStart(2, '0')}${String(receipt.receiptDate.getDate()).padStart(2, '0')}`
                    : receipt.timestamp
                        ? `${receipt.timestamp.getFullYear()}${String(receipt.timestamp.getMonth() + 1).padStart(2, '0')}${String(receipt.timestamp.getDate()).padStart(2, '0')}`
                        : 'unknown';
                const vendorStr = receipt.vendor ? receipt.vendor.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20) : 'receipt';
                const filename = `${dateStr}_${vendorStr}_${receipt.id || i}.jpg`;

                // BlobをそのままZIPに追加（元のサイズを保持）
                zip.file(filename, receipt.image);
            }

            // ZIPファイルを生成してダウンロード
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(zipBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `receipt_images_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            setShowExportModal(false);
        } catch (error) {
            console.error('Failed to export images:', error);
            alert(`画像のエクスポートに失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}\nJSZipライブラリをインストールしてください: npm install jszip`);
        }
    };

    // 汎用CSV形式を生成
    const generateGenericCSV = (receipts: Receipt[]): string => {
        const headers = ['日付', '時刻', '店名', '金額', '通貨', 'インボイス番号', '備考'];
        const rows = receipts.map(receipt => {
            // 日付を取得
            let dateStr = '';
            if (receipt.receiptDate) {
                const d = receipt.receiptDate;
                dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
            } else if (receipt.date) {
                dateStr = receipt.date;
            } else if (receipt.timestamp) {
                const d = receipt.timestamp instanceof Date ? receipt.timestamp : new Date(receipt.timestamp);
                dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
            }

            // 時刻を取得
            let timeStr = receipt.time || '';
            if (!timeStr && receipt.receiptDate) {
                const d = receipt.receiptDate;
                timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            }

            // 金額（数値として）
            const amount = receipt.amount || 0;

            // 備考欄
            let memo = receipt.note || '';
            if (receipt.currency === 'THB') {
                memo = memo ? `${memo} / 外貨: THB` : '外貨: THB';
            }

            return [
                dateStr,
                timeStr,
                receipt.vendor || '',
                amount.toString(),
                receipt.currency || 'JPY',
                receipt.invoice_number || '',
                memo
            ];
        });

        // CSV形式に変換（値にカンマや改行が含まれる場合はダブルクォートで囲む）
        const escapeCSV = (value: string | number): string => {
            const str = String(value);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const csvRows = [
            headers.map(escapeCSV).join(','),
            ...rows.map(row => row.map(escapeCSV).join(','))
        ];

        return csvRows.join('\n');
    };

    // freee形式CSVを生成
    const generateFreeeCSV = (receipts: Receipt[]): string => {
        // freeeのインポート形式に合わせる
        const headers = ['収支区分', '管理番号', '発生日', '勘定科目', '金額', '税区分', '税額', '備考', '品目'];
        const rows = receipts.map(receipt => {
            // 収支区分: 支出
            const category = '支出';

            // 管理番号: インボイス番号またはID
            const managementNumber = receipt.invoice_number || `RECEIPT-${receipt.id || ''}`;

            // 発生日
            let dateStr = '';
            if (receipt.receiptDate) {
                const d = receipt.receiptDate;
                dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
            } else if (receipt.date) {
                dateStr = receipt.date.replace(/-/g, '/');
            } else if (receipt.timestamp) {
                const d = receipt.timestamp instanceof Date ? receipt.timestamp : new Date(receipt.timestamp);
                dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
            }

            // 勘定科目: 未確定（ユーザーが後で設定）
            const account = '未確定';

            // 金額（数値）
            const amount = receipt.amount || 0;

            // 税区分: 対象外（デフォルト）
            const taxCategory = '対象外';

            // 税額: 0
            const taxAmount = 0;

            // 備考
            let memo = receipt.note || '';
            if (receipt.currency === 'THB') {
                memo = memo ? `${memo} / 外貨: THB` : '外貨: THB';
            }
            memo = memo ? `${memo} / 店名: ${receipt.vendor || ''}` : `店名: ${receipt.vendor || ''}`;

            // 品目: 店名
            const item = receipt.vendor || '';

            return [
                category,
                managementNumber,
                dateStr,
                account,
                amount.toString(),
                taxCategory,
                taxAmount.toString(),
                memo,
                item
            ];
        });

        const escapeCSV = (value: string | number): string => {
            const str = String(value);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const csvRows = [
            headers.map(escapeCSV).join(','),
            ...rows.map(row => row.map(escapeCSV).join(','))
        ];

        return csvRows.join('\n');
    };

    // マネーフォワード形式CSVを生成
    const generateMoneyForwardCSV = (receipts: Receipt[]): string => {
        // マネーフォワードのインポート形式に合わせる
        const headers = ['計算区分', '日付', '内容', '金額（円）', '保有金融機関', '大項目', '中項目', 'メモ', '振替', '残高調整', '通貨', '金額（外貨）'];
        const rows = receipts.map(receipt => {
            // 計算区分: 支出
            const calculationType = '支出';

            // 日付
            let dateStr = '';
            if (receipt.receiptDate) {
                const d = receipt.receiptDate;
                dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
            } else if (receipt.date) {
                dateStr = receipt.date.replace(/-/g, '/');
            } else if (receipt.timestamp) {
                const d = receipt.timestamp instanceof Date ? receipt.timestamp : new Date(receipt.timestamp);
                dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
            }

            // 内容: 店名
            const content = receipt.vendor || '';

            // 金額（円）: JPYの場合はそのまま、THBの場合は0（外貨欄に記載）
            const amountJPY = receipt.currency === 'JPY' ? (receipt.amount || 0) : 0;

            // 保有金融機関: 空
            const financialInstitution = '';

            // 大項目・中項目: 空（ユーザーが後で設定）
            const largeCategory = '';
            const mediumCategory = '';

            // メモ
            let memo = receipt.note || '';
            if (receipt.invoice_number) {
                memo = memo ? `${memo} / インボイス: ${receipt.invoice_number}` : `インボイス: ${receipt.invoice_number}`;
            }

            // 振替・残高調整: 空
            const transfer = '';
            const balanceAdjustment = '';

            // 通貨: THBの場合はTHB、JPYの場合は空
            const currency = receipt.currency === 'THB' ? 'THB' : '';

            // 金額（外貨）: THBの場合は金額、JPYの場合は空
            const amountForeign = receipt.currency === 'THB' ? (receipt.amount || 0) : '';

            return [
                calculationType,
                dateStr,
                content,
                amountJPY.toString(),
                financialInstitution,
                largeCategory,
                mediumCategory,
                memo,
                transfer,
                balanceAdjustment,
                currency,
                amountForeign.toString()
            ];
        });

        const escapeCSV = (value: string | number): string => {
            const str = String(value);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const csvRows = [
            headers.map(escapeCSV).join(','),
            ...rows.map(row => row.map(escapeCSV).join(','))
        ];

        return csvRows.join('\n');
    };

    // OpenCV.jsの読み込みを確認（重複読み込みを防ぐ）
    useEffect(() => {
        if (typeof window === 'undefined') return;

        // 既に読み込まれているか確認
        if (window.cv && window.cv.Mat) {
            console.log('OpenCV.js is already loaded');
            setIsOpenCvReady(true);
            return;
        }

        // onRuntimeInitializedイベントを設定（スクリプトが読み込まれる前に設定）
        const checkInterval = setInterval(() => {
            if (window.cv) {
                if (window.cv.Mat) {
                    // 既に初期化済み
                    console.log('OpenCV.js is ready');
                    setIsOpenCvReady(true);
                    clearInterval(checkInterval);
                } else if (window.cv.onRuntimeInitialized !== undefined) {
                    // 初期化イベントを設定
                    const originalCallback = window.cv.onRuntimeInitialized;
                    window.cv.onRuntimeInitialized = () => {
                        console.log('OpenCV.js runtime initialized');
                        setIsOpenCvReady(true);
                        if (originalCallback) {
                            originalCallback();
                        }
                    };
                    clearInterval(checkInterval);
                }
            }
        }, 100);

        // 10秒後にタイムアウト
        setTimeout(() => {
            clearInterval(checkInterval);
        }, 10000);

        return () => {
            clearInterval(checkInterval);
        };
    }, []);

    // 4つの頂点を数学的にソート（左上、右上、右下、左下の順）
    const sortCorners = (corners: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> => {
        if (corners.length !== 4) {
            return corners;
        }

        // 各点の特徴量を計算
        const cornersWithFeatures = corners.map((corner, index) => ({
            ...corner,
            index,
            sum: corner.x + corner.y,      // (x+y): 左上が最小、右下が最大
            diff: corner.x - corner.y,    // (x-y): 左下が最小、右上が最大
        }));

        // 左上: (x+y)が最小
        const topLeft = cornersWithFeatures.reduce((min, corner) =>
            corner.sum < min.sum ? corner : min
        );

        // 右下: (x+y)が最大
        const bottomRight = cornersWithFeatures.reduce((max, corner) =>
            corner.sum > max.sum ? corner : max
        );

        // 残りの2点から右上と左下を判定
        const remaining = cornersWithFeatures.filter(
            corner => corner.index !== topLeft.index && corner.index !== bottomRight.index
        );

        // 右上: (x-y)が最大
        const topRight = remaining.reduce((max, corner) =>
            corner.diff > max.diff ? corner : max
        );

        // 左下: (x-y)が最小
        const bottomLeft = remaining.reduce((min, corner) =>
            corner.diff < min.diff ? corner : min
        );

        return [
            { x: topLeft.x, y: topLeft.y },        // 左上
            { x: topRight.x, y: topRight.y },      // 右上
            { x: bottomRight.x, y: bottomRight.y }, // 右下
            { x: bottomLeft.x, y: bottomLeft.y },  // 左下
        ];
    };

    // 画像を回転させる関数（テキストが水平に読めるように）
    const rotateImageForTextOrientation = async (
        imageBlob: Blob,
        rotationNeeded: number
    ): Promise<Blob> => {
        // rotation_neededが0の場合は回転不要
        if (rotationNeeded === 0 || rotationNeeded === undefined || rotationNeeded === null) {
            return imageBlob;
        }

        return new Promise((resolve, reject) => {
            const img = new Image();
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                reject(new Error('Canvas context not available'));
                return;
            }

            img.onload = () => {
                try {
                    // rotation_neededに基づいて回転角度を決定
                    // 1: 270度反時計回り（右に90度回転している状態を修正）
                    // 2: 180度回転（上下逆さまを修正）
                    // 3: 90度時計回り（左に90度回転している状態を修正）
                    let rotationAngle = 0;
                    let newWidth = img.width;
                    let newHeight = img.height;

                    switch (rotationNeeded) {
                        case 1:
                            rotationAngle = -90; // 270度反時計回り = -90度
                            newWidth = img.height;
                            newHeight = img.width;
                            break;
                        case 2:
                            rotationAngle = 180;
                            break;
                        case 3:
                            rotationAngle = 90;
                            newWidth = img.height;
                            newHeight = img.width;
                            break;
                        default:
                            resolve(imageBlob);
                            return;
                    }

                    console.log(`Rotating image: rotation_needed=${rotationNeeded}, angle=${rotationAngle} degrees`);

                    // Canvasのサイズを設定（回転後のサイズ）
                    canvas.width = newWidth;
                    canvas.height = newHeight;

                    // 回転の中心を設定
                    ctx.translate(newWidth / 2, newHeight / 2);
                    ctx.rotate((rotationAngle * Math.PI) / 180);
                    ctx.translate(-img.width / 2, -img.height / 2);

                    // 画像を描画
                    ctx.drawImage(img, 0, 0);

                    // Blobに変換
                    canvas.toBlob(
                        (blob) => {
                            if (blob) {
                                resolve(blob);
                            } else {
                                reject(new Error('Failed to convert canvas to blob'));
                            }
                        },
                        'image/jpeg',
                        0.95 // 高画質
                    );
                } catch (error) {
                    console.error('Image rotation failed:', error);
                    resolve(imageBlob); // エラー時は元の画像を返す
                }
            };

            img.onerror = () => {
                reject(new Error('Failed to load image for rotation'));
            };

            img.src = URL.createObjectURL(imageBlob);
        });
    };

    // OpenCV.jsを使用したシンプルな透視変換（Perspective Transform）
    // 回転処理は一切行わず、検出された4点をそのまま正対化するだけ
    const applyPerspectiveCorrection = async (
        imageBlob: Blob,
        corners: Array<{ x: number; y: number }>,
        imageWidth: number,
        imageHeight: number
    ): Promise<Blob> => {
        return new Promise((resolve, reject) => {
            // OpenCV.jsが読み込まれていない場合は元の画像を返す
            if (!isOpenCvReady || !window.cv || !window.cv.Mat) {
                console.warn('OpenCV.js is not ready, using original image');
                resolve(imageBlob);
                return;
            }

            const img = new Image();
            const srcCanvas = document.createElement('canvas');
            const dstCanvas = document.createElement('canvas');
            const srcCtx = srcCanvas.getContext('2d');
            const dstCtx = dstCanvas.getContext('2d');

            if (!srcCtx || !dstCtx) {
                reject(new Error('Canvas context not available'));
                return;
            }

            img.onload = () => {
                try {
                    // ソース画像をCanvasに描画
                    srcCanvas.width = img.width;
                    srcCanvas.height = img.height;
                    srcCtx.drawImage(img, 0, 0);

                    // 正規化座標（0-1000）を実際の画像座標に変換
                    const rawCorners = corners.map(corner => ({
                        x: (corner.x / 1000) * img.width,
                        y: (corner.y / 1000) * img.height,
                    }));

                    // 4つの頂点を数学的にソート（左上、右上、右下、左下の順）
                    const srcCorners = sortCorners(rawCorners);

                    // レシートの縦横比を正確に計算（4点の座標から、真正面から見た状態を想定）
                    // 台形補正後の長方形のアスペクト比を計算
                    const topWidth = Math.sqrt(
                        Math.pow(srcCorners[1].x - srcCorners[0].x, 2) +
                        Math.pow(srcCorners[1].y - srcCorners[0].y, 2)
                    );
                    const bottomWidth = Math.sqrt(
                        Math.pow(srcCorners[2].x - srcCorners[3].x, 2) +
                        Math.pow(srcCorners[2].y - srcCorners[3].y, 2)
                    );
                    const leftHeight = Math.sqrt(
                        Math.pow(srcCorners[3].x - srcCorners[0].x, 2) +
                        Math.pow(srcCorners[3].y - srcCorners[0].y, 2)
                    );
                    const rightHeight = Math.sqrt(
                        Math.pow(srcCorners[2].x - srcCorners[1].x, 2) +
                        Math.pow(srcCorners[2].y - srcCorners[1].y, 2)
                    );

                    // 上辺・下辺の平均幅（W）と左辺・右辺の平均高さ（H）を算出
                    const W = (topWidth + bottomWidth) / 2;  // 平均幅
                    const H = (leftHeight + rightHeight) / 2;  // 平均高さ

                    // アスペクト比を計算
                    const aspectRatio = H / W;

                    console.log(`Receipt dimensions: W=${W.toFixed(1)}, H=${H.toFixed(1)}, aspect ratio: ${aspectRatio.toFixed(3)}`);

                    // 出力サイズを決定：レシートのアスペクト比を維持
                    const maxDimension = 2000; // 最大解像度
                    const minDimension = 800; // 最小解像度

                    let outputWidth: number;
                    let outputHeight: number;

                    // 幅と高さのどちらを基準にするか決定
                    if (W > H) {
                        // 横長レシート：高さを基準に、縦横比を維持しながら最大2000pxまで拡大
                        const baseHeight = Math.min(maxDimension, Math.max(minDimension, H));
                        outputHeight = Math.round(baseHeight);
                        outputWidth = Math.round(outputHeight / aspectRatio);

                        // 幅が2000pxを超える場合は、幅を基準に調整
                        if (outputWidth > maxDimension) {
                            outputWidth = maxDimension;
                            outputHeight = Math.round(outputWidth * aspectRatio);
                        }
                    } else {
                        // 縦長レシート：幅を基準に、縦横比を維持しながら最大2000pxまで拡大
                        const baseWidth = Math.min(maxDimension, Math.max(minDimension, W));
                        outputWidth = Math.round(baseWidth);
                        outputHeight = Math.round(outputWidth * aspectRatio);

                        // 高さが2000pxを超える場合は、高さを基準に調整
                        if (outputHeight > maxDimension) {
                            outputHeight = maxDimension;
                            outputWidth = Math.round(outputHeight / aspectRatio);
                        }
                    }

                    console.log(`Output size: ${outputWidth}x${outputHeight} (aspect ratio: ${aspectRatio.toFixed(2)})`);

                    // OpenCV.jsのMatオブジェクトを作成
                    const srcMat = window.cv.imread(srcCanvas);

                    // 出力Canvasのサイズを設定
                    dstCanvas.width = outputWidth;
                    dstCanvas.height = outputHeight;

                    // ソース点とターゲット点を準備
                    const srcPoints = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, [
                        srcCorners[0].x, srcCorners[0].y, // 左上
                        srcCorners[1].x, srcCorners[1].y, // 右上
                        srcCorners[2].x, srcCorners[2].y, // 右下
                        srcCorners[3].x, srcCorners[3].y, // 左下
                    ]);

                    // ターゲット点：出力Canvasの四隅
                    const dstPoints = window.cv.matFromArray(4, 1, window.cv.CV_32FC2, [
                        0, 0,                                    // 左上
                        outputWidth, 0,                          // 右上
                        outputWidth, outputHeight,                // 右下
                        0, outputHeight,                         // 左下
                    ]);

                    // 透視変換行列を計算
                    const M = window.cv.getPerspectiveTransform(srcPoints, dstPoints);

                    // 透視変換を適用
                    const dstMat = new window.cv.Mat();
                    const dsize = new window.cv.Size(outputWidth, outputHeight);
                    const interpolationMethod = window.cv.INTER_CUBIC || window.cv.INTER_LINEAR;

                    console.log(`Applying perspective transform with ${interpolationMethod === window.cv.INTER_CUBIC ? 'INTER_CUBIC' : 'INTER_LINEAR'}`);

                    window.cv.warpPerspective(
                        srcMat,
                        dstMat,
                        M,
                        dsize,
                        interpolationMethod,
                        window.cv.BORDER_CONSTANT,
                        new window.cv.Scalar()
                    );

                    // 結果をCanvasに描画
                    window.cv.imshow(dstCanvas, dstMat);

                    // メモリを解放
                    srcMat.delete();
                    dstMat.delete();
                    srcPoints.delete();
                    dstPoints.delete();
                    M.delete();

                    // 一時的なCanvasを削除
                    document.body.removeChild(srcCanvas);

                    // Blobに変換（高画質で保存）
                    dstCanvas.toBlob(
                        (blob) => {
                            if (blob) {
                                resolve(blob);
                            } else {
                                reject(new Error('Failed to convert canvas to blob'));
                            }
                        },
                        'image/jpeg',
                        0.95 // 高画質（0.95）
                    );
                } catch (error) {
                    console.error('OpenCV perspective correction failed:', error);
                    // エラーが発生した場合は元の画像を返す
                    try {
                        document.body.removeChild(srcCanvas);
                    } catch (e) {
                        // 既に削除されている場合は無視
                    }
                    resolve(imageBlob);
                }
            };

            img.onerror = () => {
                try {
                    document.body.removeChild(srcCanvas);
                } catch (e) {
                    // 既に削除されている場合は無視
                }
                reject(new Error('Failed to load image'));
            };

            // CanvasにIDを設定してDOMに追加（OpenCV.jsが読み込むため）
            srcCanvas.id = 'src-canvas-' + Date.now();
            srcCanvas.style.display = 'none';
            document.body.appendChild(srcCanvas);

            img.src = URL.createObjectURL(imageBlob);
        });
    };


    // Gemini APIを使用してOCRで金額、店名、日付、時刻、インボイス番号、四隅の座標を抽出
    const extractAmountFromOcr = async (imageBlob: Blob, skipStateUpdate: boolean = false): Promise<{
        amount: number;
        vendor: string;
        date?: string;
        time?: string;
        invoice_number?: string;
        currency?: string | null;
        corners?: Array<{ x: number; y: number }>;
        expenseCategory?: ExpenseCategory;
        categoryReason?: string;
        confidenceScore?: number;
        rotation_needed?: number;
        hasWarning: boolean
    }> => {
        try {
            if (!skipStateUpdate) {
                setIsOcrProcessing(true);
                setOcrWarning(null);
            }

            // FormDataを作成して画像を送信
            const formData = new FormData();
            formData.append('image', imageBlob, 'receipt.jpg');

            // APIエンドポイントにリクエスト
            const response = await fetch('/api/ocr', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                // エラーレスポンスを取得（空の場合も考慮）
                let errorData: any = {};
                let responseText = '';

                try {
                    // レスポンスボディをテキストとして取得
                    responseText = await response.text();
                    console.log('Raw error response text:', responseText);

                    if (responseText && responseText.trim() !== '') {
                        try {
                            errorData = JSON.parse(responseText);
                        } catch (jsonError) {
                            console.error('Failed to parse JSON from error response:', jsonError);
                            // JSONパースに失敗した場合、テキストをそのまま使用
                            errorData = {
                                error: 'Invalid JSON response',
                                rawText: responseText.substring(0, 200)
                            };
                        }
                    } else {
                        console.warn('Empty error response body');
                        errorData = { error: 'Empty response body' };
                    }
                } catch (textError) {
                    console.error('Failed to read error response text:', textError);
                    errorData = { error: 'Failed to read error response' };
                }

                console.error('OCR API error response:', {
                    status: response.status,
                    statusText: response.statusText,
                    responseTextLength: responseText.length,
                    errorData: errorData,
                    errorDataKeys: Object.keys(errorData)
                });

                // ユーザーフレンドリーなエラーメッセージを取得
                let errorMessage = errorData.userMessage ||
                    errorData.message ||
                    errorData.error;

                // エラーデータが空の場合、ステータスコードから推測
                if (!errorMessage || Object.keys(errorData).length === 0) {
                    if (response.status === 503) {
                        errorMessage = 'モデルが過負荷のため、しばらく待ってから再度お試しください。';
                    } else if (response.status === 429) {
                        // クォータ超過エラーの詳細を取得
                        const quotaLimit = errorData.quotaLimit || '20';
                        const retryAfter = errorData.retryAfter;
                        if (retryAfter) {
                            const minutes = Math.floor(retryAfter / 60);
                            const seconds = retryAfter % 60;
                            errorMessage = `無料プランの1日あたりのリクエスト制限（${quotaLimit}回）に達しました。${minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`}後に再度お試しください。`;
                        } else {
                            errorMessage = `無料プランの1日あたりのリクエスト制限（${quotaLimit}回）に達しました。明日に再度お試しください。`;
                        }
                    } else if (response.status === 401 || response.status === 403) {
                        errorMessage = 'APIキーの設定を確認してください。';
                    } else if (response.status === 500) {
                        errorMessage = 'サーバーエラーが発生しました。APIキーの設定を確認してください。';
                    } else if (response.status === 404) {
                        errorMessage = 'APIエンドポイントが見つかりません';
                    } else {
                        errorMessage = 'OCR処理に失敗しました';
                    }
                }

                // ユーザーに警告を表示
                setOcrWarning(errorMessage);
                setTimeout(() => setOcrWarning(null), 10000); // 10秒後に警告を消す

                // 詳細なエラーメッセージをスロー
                throw new Error(`OCR API error (${response.status}): ${response.statusText} - ${errorMessage}`);
            }

            const data = await response.json();
            console.log('OCR API response:', data);

            // rotation_neededを取得
            const rotationNeeded = data.rotation_needed !== undefined ? data.rotation_needed : 0;

            // レスポンスデータの検証
            if (!data || typeof data !== 'object') {
                console.error('Invalid response data:', data);
                throw new Error('Invalid response format from OCR API');
            }

            // 金額が0の場合は警告を表示
            const hasWarning = data.amount === 0 || !data.amount;

            // Gemini APIからの解析結果を返す（vendor, amount, date, time, invoice_number, currency, corners, expenseCategory, categoryReason, confidenceScore, rotation_needed）
            return {
                amount: data.amount || 0,
                vendor: data.vendor || '',
                date: data.date || undefined,
                time: data.time || undefined,
                invoice_number: data.invoice_number || undefined,
                currency: data.currency || undefined,
                corners: data.corners || undefined,
                expenseCategory: (data.expenseCategory || '雑費') as ExpenseCategory,
                categoryReason: data.categoryReason || undefined,
                confidenceScore: data.confidenceScore !== undefined ? data.confidenceScore : 0.5,
                rotation_needed: rotationNeeded,
                hasWarning,
            };
        } catch (err) {
            console.error('OCR processing failed:', err);
            const errorMessage = err instanceof Error ? err.message : String(err);

            // エラーメッセージをユーザーに表示
            if (!skipStateUpdate) {
                setOcrWarning(`OCR処理に失敗しました: ${errorMessage}`);
                setTimeout(() => setOcrWarning(null), 10000);
            }

            // エラー情報を含めて返す
            return {
                amount: 0,
                vendor: '',
                expenseCategory: '雑費' as ExpenseCategory,
                rotation_needed: 0,
                hasWarning: true
            };
        } finally {
            if (!skipStateUpdate) {
                setIsOcrProcessing(false);
            }
        }
    };

    // インテリジェントな画像圧縮（モバイル最適化）
    // 長辺1200px、品質0.75-0.8、400KB超の場合は自動調整して200-300KBに
    const compressImageIntelligently = (file: File): Promise<Blob> => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            let objectUrl: string | null = null;

            if (!ctx) {
                reject(new Error('Canvas context not available'));
                return;
            }

            img.onload = () => {
                let width = img.width;
                let height = img.height;

                // 長辺を1200pxにリサイズ（解析速度向上のため最適化）
                const maxDimension = 1200;
                if (width > height) {
                    if (width > maxDimension) {
                        height = (height * maxDimension) / width;
                        width = maxDimension;
                    }
                } else {
                    if (height > maxDimension) {
                        width = (width * maxDimension) / height;
                        height = maxDimension;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);

                // 品質を段階的に調整して200KB程度に抑える
                const compressWithQuality = (quality: number): Promise<Blob> => {
                    return new Promise((resolve, reject) => {
                        canvas.toBlob(
                            (blob) => {
                                if (!blob) {
                                    reject(new Error('Failed to compress image'));
                                    return;
                                }

                                // 200KB超の場合は品質を下げて再試行（解析速度向上のため200KB以下を目標）
                                if (blob.size > 200 * 1024 && quality > 0.75) {
                                    const newQuality = Math.max(0.75, quality - 0.05);
                                    console.log(`Image size ${(blob.size / 1024).toFixed(0)}KB exceeds 200KB, reducing quality to ${newQuality}`);
                                    compressWithQuality(newQuality).then(resolve).catch(reject);
                                } else {
                                    console.log(`Image compressed: ${(blob.size / 1024).toFixed(0)}KB, quality: ${quality}`);
                                    resolve(blob);
                                }
                            },
                            'image/jpeg',
                            quality
                        );
                    });
                };

                // 初期品質0.85から開始（解析速度と品質のバランスを最適化）
                compressWithQuality(0.85)
                    .then((blob) => {
                        if (objectUrl) {
                            URL.revokeObjectURL(objectUrl);
                        }
                        resolve(blob);
                    })
                    .catch((error) => {
                        if (objectUrl) {
                            URL.revokeObjectURL(objectUrl);
                        }
                        reject(error);
                    });
            };

            img.onerror = () => {
                if (objectUrl) {
                    URL.revokeObjectURL(objectUrl);
                }
                reject(new Error('Failed to load image'));
            };

            objectUrl = URL.createObjectURL(file);
            img.src = objectUrl;
        });
    };

    // 補正用の画像読み込み（圧縮なし、元の解像度を維持）
    const loadImageForCorrection = (file: File): Promise<{ blob: Blob; width: number; height: number }> => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            let objectUrl: string | null = null;

            img.onload = () => {
                // 元の画像をそのままBlobとして取得（圧縮なし）
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Canvas context not available'));
                    return;
                }
                ctx.drawImage(img, 0, 0);

                canvas.toBlob((blob) => {
                    if (objectUrl) {
                        URL.revokeObjectURL(objectUrl);
                    }
                    if (blob) {
                        resolve({
                            blob,
                            width: img.width,
                            height: img.height
                        });
                    } else {
                        reject(new Error('Failed to convert image to blob'));
                    }
                }, 'image/jpeg', 1.0); // 圧縮なし
            };

            img.onerror = () => {
                if (objectUrl) {
                    URL.revokeObjectURL(objectUrl);
                }
                reject(new Error('Failed to load image'));
            };

            objectUrl = URL.createObjectURL(file);
            img.src = objectUrl;
        });
    };

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            // 【二重圧縮の防止】処理順序を最適化
            // 1. まず元の高解像度画像を読み込む（台形補正用）
            const originalImage = await loadImageForCorrection(file);

            // 2. OCR用にインテリジェントな圧縮（長辺1200px、品質0.75-0.8、400KB以下に調整）
            const ocrImageBlob = await compressImageIntelligently(file);

            const db = getDb();
            if (!db) {
                alert('データベースにアクセスできません。ページを再読み込みしてください。');
                return;
            }

            // 3. OCRで金額、店名、日付、時刻、インボイス番号、四隅の座標、勘定科目、回転情報を抽出（軽量画像を使用）
            const {
                amount: extractedAmount,
                vendor: extractedVendor,
                date: extractedDate,
                time: extractedTime,
                invoice_number: extractedInvoiceNumber,
                currency: extractedCurrency,
                corners,
                expenseCategory: extractedExpenseCategory,
                categoryReason: extractedCategoryReason,
                confidenceScore: extractedConfidenceScore,
                rotation_needed,
                hasWarning
            } = await extractAmountFromOcr(ocrImageBlob);

            if (hasWarning) {
                setOcrWarning('金額を確認してください。読み取り精度が低い可能性があります。');
                setTimeout(() => setOcrWarning(null), 5000);
            }

            // 4. 台形補正を適用（cornersが存在する場合、元の高解像度画像を使用）
            let finalImageBlob = originalImage.blob; // 元の高解像度画像をデフォルトに
            if (corners && corners.length === 4) {
                try {
                    console.log('Applying perspective correction with corners:', corners);
                    console.log('Using original high-resolution image for correction:', originalImage.width, 'x', originalImage.height);
                    finalImageBlob = await applyPerspectiveCorrection(
                        originalImage.blob, // 元の高解像度画像を使用
                        corners,
                        originalImage.width,
                        originalImage.height
                    );
                    console.log('Perspective correction applied successfully');
                } catch (correctionError) {
                    console.warn('Failed to apply perspective correction, using original image:', correctionError);
                    // エラー時は元の高解像度画像を使用
                }
            }

            // 5. テキストの向きに基づいて画像を回転（rotation_neededに基づく）
            if (rotation_needed !== undefined && rotation_needed !== null && rotation_needed !== 0) {
                try {
                    console.log(`Rotating image for text orientation: rotation_needed=${rotation_needed}`);
                    finalImageBlob = await rotateImageForTextOrientation(finalImageBlob, rotation_needed);
                    console.log('Image rotation for text orientation applied successfully');
                } catch (rotationError) {
                    console.warn('Failed to rotate image for text orientation, using original image:', rotationError);
                    // エラー時は回転前の画像を使用
                }
            }

            // receiptDateを計算（Geminiが読み取った日時を優先的に使用）
            // レシート内に印字されている実際の日時を優先的に保存
            let receiptDate: Date | undefined = undefined;
            if (extractedDate) {
                try {
                    // 日付形式のパース（YYYY/MM/DD）
                    const dateParts = extractedDate.split('/');
                    if (dateParts.length === 3) {
                        const year = parseInt(dateParts[0], 10);
                        const month = parseInt(dateParts[1], 10);
                        const day = parseInt(dateParts[2], 10);

                        if (extractedTime) {
                            // 時刻も含めてパース（HH:mm）
                            const timeParts = extractedTime.split(':');
                            if (timeParts.length >= 2) {
                                const hours = parseInt(timeParts[0], 10);
                                const minutes = parseInt(timeParts[1], 10);
                                receiptDate = new Date(year, month - 1, day, hours || 0, minutes || 0);
                            } else {
                                receiptDate = new Date(year, month - 1, day);
                            }
                        } else {
                            receiptDate = new Date(year, month - 1, day);
                        }

                        console.log('Parsed receipt date from Gemini:', receiptDate);
                    }
                } catch (dateError) {
                    console.warn('Failed to parse receipt date:', dateError, 'Date string:', extractedDate, 'Time string:', extractedTime);
                }
            }

            const receipt: Receipt = {
                image: finalImageBlob, // 台形補正後の画像を保存（一発のOCR結果を正として保存）
                timestamp: new Date(), // 撮影日時
                note: '',
                amount: extractedAmount,
                vendor: extractedVendor,
                currency: extractedCurrency || 'JPY', // 通貨コードを保存（デフォルトはJPY）
                date: extractedDate,
                time: extractedTime,
                receiptDate: receiptDate, // Geminiが読み取った日時
                invoice_number: extractedInvoiceNumber,
                corners: corners,
                expenseCategory: (extractedExpenseCategory ?? '雑費') as ExpenseCategory, // 勘定科目
                categoryReason: extractedCategoryReason,
                confidenceScore: extractedConfidenceScore,
            };

            await db.receipts.add(receipt);
            await loadReceipts();
        } catch (error) {
            console.error('Failed to save receipt:', error);
            alert('画像の保存に失敗しました');
        } finally {
            setIsOcrProcessing(false);
        }

        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    // デバイス判定（モバイルかPCか）
    // タッチ操作が可能、またはuserAgentで判定
    const isMobileDevice = (): boolean => {
        if (typeof window === 'undefined') return false;
        const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const isSmallScreen = window.innerWidth <= 768;
        return hasTouch || isMobileUA || isSmallScreen;
    };

    const startCamera = async () => {
        try {
            // navigator.mediaDevicesの存在確認
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                const isHTTPS = location.protocol === 'https:';
                const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

                let errorMessage = 'カメラAPIが利用できません。\n\n';

                if (!isHTTPS && !isLocalhost) {
                    errorMessage += '⚠️ HTTPS接続が必要です。\n';
                    errorMessage += 'スマートフォンでカメラを使用するには、HTTPS（https://）での接続が必要です。\n\n';
                    errorMessage += '現在の接続: ' + location.protocol + '//' + location.host + '\n\n';
                    errorMessage += '解決方法:\n';
                    errorMessage += '1. PCのブラウザで http://localhost:3000 にアクセスしてテスト\n';
                    errorMessage += '2. または、ngrokなどのツールでHTTPSトンネルを作成\n';
                    errorMessage += '3. または、本番環境（HTTPS）でテスト';
                } else {
                    errorMessage += 'お使いのブラウザはカメラAPIをサポートしていない可能性があります。\n';
                    errorMessage += '最新のブラウザ（Chrome、Safari、Firefox）をお試しください。';
                }

                alert(errorMessage);
                throw new Error('MediaDevices API not available');
            }

            // デバイス別カメラ制御: モバイルは背面カメラ、PCは正面カメラ
            const isMobile = isMobileDevice();
            const preferredFacingMode = isMobile ? 'environment' : 'user';

            console.log(`Device type: ${isMobile ? 'Mobile' : 'PC'}, Using camera: ${preferredFacingMode}`);

            // 段階的に制約を緩和して試行（ideal: 1080pを要求）
            const constraintsList: MediaStreamConstraints[] = [
                // 1. 最優先: デバイスに応じたカメラ + 1080p
                {
                    video: {
                        facingMode: preferredFacingMode,
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                },
                // 2. デバイスに応じたカメラ + 1080p（縦持ち対応）
                {
                    video: {
                        facingMode: preferredFacingMode,
                        width: { ideal: 1080 },
                        height: { ideal: 1920 },
                    },
                },
                // 3. デバイスに応じたカメラのみ（解像度指定なし）
                {
                    video: {
                        facingMode: preferredFacingMode,
                    },
                },
                // 4. フォールバック: カメラ指定なし
                {
                    video: true,
                },
            ];

            let mediaStream: MediaStream | null = null;
            let lastError: any = null;

            for (const constraints of constraintsList) {
                try {
                    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
                    console.log('Camera accessed successfully with constraints:', constraints);
                    break;
                } catch (error: any) {
                    lastError = error;
                    console.warn('Failed with constraints:', constraints, error.name);
                    // OverconstrainedErrorの場合は次の制約を試す
                    if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') {
                        continue;
                    }
                    // その他のエラー（権限エラーなど）の場合は中断
                    throw error;
                }
            }

            if (!mediaStream) {
                throw lastError || new Error('Failed to access camera with all constraints');
            }

            // カメラのライト（フラッシュ）を自動的に点灯（モバイルデバイスでサポートされている場合）
            try {
                const videoTrack = mediaStream.getVideoTracks()[0];
                if (videoTrack && 'applyConstraints' in videoTrack) {
                    // torch（懐中電灯モード）を有効化
                    await videoTrack.applyConstraints({
                        advanced: [{ torch: true } as any]
                    });
                    console.log('Camera torch/flash enabled');
                }
            } catch (torchError: any) {
                // torchがサポートされていない場合やエラーが発生した場合は無視
                console.log('Torch/flash not supported or failed to enable:', torchError.message);
            }

            setStream(mediaStream);
            setIsCameraActive(true);
        } catch (error: any) {
            console.error('Failed to access camera:', error);

            // MediaDevices API not available のエラーは既にアラートを表示済み
            if (error.message === 'MediaDevices API not available') {
                return;
            }

            let errorMessage = 'カメラへのアクセスに失敗しました。\n\n';

            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                errorMessage += 'カメラの権限が拒否されました。\nブラウザの設定でカメラへのアクセスを許可してください。';
            } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
                errorMessage += 'カメラが見つかりませんでした。\nデバイスにカメラが接続されているか確認してください。';
            } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
                errorMessage += 'カメラが使用中です。\n他のアプリでカメラを使用していないか確認してください。';
            } else if (location.protocol === 'http:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
                errorMessage += 'HTTPS接続が必要な場合があります。\nスマートフォンでアクセスする場合、HTTPS（https://）での接続が必要な場合があります。\n\n現在の接続: ' + location.protocol + '//' + location.host;
            } else {
                errorMessage += 'エラー: ' + (error.message || error.name || '不明なエラー');
            }

            alert(errorMessage);
        }
    };

    useEffect(() => {
        if (isCameraActive && stream && videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch((err) => {
                console.error('Failed to play video:', err);
            });
        }
    }, [isCameraActive, stream]);

    const stopCamera = () => {
        // リアルタイム検出を停止
        if (detectionAnimationFrameRef.current !== null) {
            cancelAnimationFrame(detectionAnimationFrameRef.current);
            detectionAnimationFrameRef.current = null;
        }
        stableDetectionStartRef.current = null;
        lastDetectedCornersRef.current = null;
        stableFrameCountRef.current = 0;
        setDetectedCorners(null);

        if (stream) {
            // カメラのライト（フラッシュ）を消す
            try {
                const videoTrack = stream.getVideoTracks()[0];
                if (videoTrack && 'applyConstraints' in videoTrack) {
                    videoTrack.applyConstraints({
                        advanced: [{ torch: false } as any]
                    }).catch((err) => {
                        console.log('Failed to disable torch:', err);
                    });
                }
            } catch (torchError) {
                // エラーは無視
            }

            stream.getTracks().forEach(track => track.stop());
            setStream(null);
            setIsCameraActive(false);
        }

        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.srcObject = null;
        }
    };

    /**
     * 4つの座標を時計回りにソートするヘルパー関数
     * 左上、右上、右下、左下の順に並び替える
     */
    const sortCornersClockwise = useCallback((points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> => {
        if (points.length !== 4) return points;

        // 重心を計算
        const centerX = points.reduce((sum, p) => sum + p.x, 0) / 4;
        const centerY = points.reduce((sum, p) => sum + p.y, 0) / 4;

        // 各点の角度を計算してソート（時計回り）
        // atan2の結果は-πからπの範囲なので、正規化して時計回りにソート
        const sorted = [...points].map((p, idx) => ({
            ...p,
            angle: Math.atan2(p.y - centerY, p.x - centerX),
            index: idx
        })).sort((a, b) => {
            // 角度を-πからπの範囲で正規化して比較
            let angleA = a.angle;
            let angleB = b.angle;

            // 時計回りにソートするため、角度を調整
            // 左上（-135度）から始まるようにする
            if (angleA < -Math.PI / 2) angleA += 2 * Math.PI;
            if (angleB < -Math.PI / 2) angleB += 2 * Math.PI;

            return angleA - angleB;
        });

        // 左上（x+yが最小）を最初に配置
        const topLeftIndex = sorted.reduce((minIdx, p, idx) =>
            (p.x + p.y < sorted[minIdx].x + sorted[minIdx].y) ? idx : minIdx, 0
        );

        // 左上から時計回りに並び替え
        const result = [
            sorted[topLeftIndex],
            sorted[(topLeftIndex + 1) % 4],
            sorted[(topLeftIndex + 2) % 4],
            sorted[(topLeftIndex + 3) % 4]
        ];

        // 座標のみを返す
        return result.map(p => ({ x: p.x, y: p.y }));
    }, []);

    /**
     * OpenCV.jsを使用してビデオフレームからレシートを検出する関数
     * 画像処理フロー: グレースケール化 → ガウシアンブラ → Cannyエッジ検出 → findContours → approxPolyDP
     * 
     * @param video - HTMLVideoElementの参照
     * @returns 正規化された4つの頂点座標（0.0〜1.0、左上、右上、右下、左下の順）またはnull
     */
    const processVideo = useCallback((video: HTMLVideoElement): Array<{ x: number; y: number }> | null => {
        if (!isOpenCvReady) {
            return null;
        }

        if (!window.cv || !window.cv.Mat) {
            return null;
        }

        // デバッグ: 最初の数回だけログを出力
        const shouldLog = Math.random() < 0.01; // 1%の確率でログ出力（パフォーマンス考慮）

        try {
            const width = video.videoWidth;
            const height = video.videoHeight;

            if (width === 0 || height === 0) {
                return null;
            }

            // OpenCV.jsの初期化チェック
            if (!window.cv || !window.cv.Mat) {
                return null;
            }

            // detectionCanvasRefを使用してビデオフレームを取得
            // detectionCanvasRefが存在しない場合は一時Canvasを作成
            let canvas: HTMLCanvasElement;
            if (detectionCanvasRef.current) {
                canvas = detectionCanvasRef.current;
                canvas.width = width;
                canvas.height = height;
            } else {
                canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
            }

            const ctx = canvas.getContext('2d');
            if (!ctx) return null;

            // ビデオフレームをCanvasに描画
            try {
                ctx.drawImage(video, 0, 0, width, height);
            } catch (drawError) {
                console.error('Failed to draw video to canvas:', drawError);
                return null;
            }

            // OpenCV.jsで画像を読み込む
            const src = window.cv.imread(canvas);
            const gray = new window.cv.Mat();
            const blurred = new window.cv.Mat();
            const edges = new window.cv.Mat();
            let contours = new (window.cv.MatVector as any)();
            let hierarchy = new window.cv.Mat();
            let thresholded: any = null;
            let morphed: any = null;
            let morphKernel: any = null;

            try {
                // グレースケール変換
                window.cv.cvtColor(src, gray, window.cv.COLOR_RGBA2GRAY);

                // 1. ノイズ除去特化型処理：背景のブラインドやレンガのノイズを除去
                // medianBlurでノイズを消す
                const medianBlurred = new window.cv.Mat();
                window.cv.medianBlur(gray, medianBlurred, 5);

                // ぼかしを最大級に強化：視力をわざと「ど近眼」にして、背景の細かい線を塗りつぶす
                const gaussianBlurred = new window.cv.Mat();
                window.cv.GaussianBlur(medianBlurred, gaussianBlurred, new window.cv.Size(21, 21), 0);
                medianBlurred.delete();

                // 2. 二値化しきい値の固定化：背景が複雑な場合、adaptiveThresholdは逆効果
                // 明るいレシート（120以上）だけを白く、それ以外を真っ黒に切り捨てる（閾値を下げて検出感度を向上）
                thresholded = new window.cv.Mat();
                window.cv.threshold(gaussianBlurred, thresholded, 120, 255, window.cv.THRESH_BINARY);
                gaussianBlurred.delete();

                // 3. オープニング処理：レシートと繋がってしまっている「細い背景の線」を一度断ち切る
                const opened = new window.cv.Mat();
                const openKernel = window.cv.getStructuringElement(window.cv.MORPH_RECT, new window.cv.Size(5, 5));
                window.cv.morphologyEx(thresholded, opened, window.cv.MORPH_OPEN, openKernel, new window.cv.Point(-1, -1), 1);
                thresholded.delete();
                openKernel.delete();

                // 4. 膨張処理（Dilation）を2回実行：バラバラの「白い点々」を一つの「大きな白い長方形の板」に結合
                const dilated1 = new window.cv.Mat();
                const dilateKernel = window.cv.getStructuringElement(window.cv.MORPH_RECT, new window.cv.Size(5, 5));
                window.cv.dilate(opened, dilated1, dilateKernel, new window.cv.Point(-1, -1), 1);

                const dilated2 = new window.cv.Mat();
                window.cv.dilate(dilated1, dilated2, dilateKernel, new window.cv.Point(-1, -1), 1);

                opened.delete();
                dilated1.delete();
                dilateKernel.delete();

                // 膨張処理後の画像を使用
                const processedBinary = dilated2;

                // デバッグ用：二値化画像をCanvasに表示
                if (debugCanvasRef.current) {
                    const debugCanvas = debugCanvasRef.current;
                    const debugCtx = debugCanvas.getContext('2d');
                    if (debugCtx) {
                        const debugWidth = Math.min(200, width / 4);
                        const debugHeight = Math.min(150, height / 4);
                        debugCanvas.width = debugWidth;
                        debugCanvas.height = debugHeight;
                        const debugMat = new window.cv.Mat();
                        window.cv.resize(processedBinary, debugMat, new window.cv.Size(debugWidth, debugHeight));
                        window.cv.imshow(debugCanvas, debugMat);
                        debugMat.delete();
                    }
                }

                // 3. 最大の白い塊を無条件で拾う：RETR_EXTERNALで外部輪郭のみを取得
                window.cv.findContours(processedBinary, contours, hierarchy, window.cv.RETR_EXTERNAL, window.cv.CHAIN_APPROX_SIMPLE);
                const contourSize = contours.size();

                // HSV変換は使用しない（彩度計算は簡略化）

                let maxScore = -1; // スコアベースの評価に変更
                let maxArea = 0; // 最大面積を保存
                let bestCorners: Array<{ x: number; y: number }> | null = null;
                let bestContour: any = null; // 最大スコアの輪郭を保存（convexHull用）

                // 3. レシート検出ロジック：顔を除外し、レシートを優先
                let bestContourIndex = -1; // 最大スコアの輪郭のインデックスを保存
                let validContourCount = 0;
                let largeContourCount = 0;
                let areaStats = { min: Infinity, max: 0, above1Percent: 0, above2Percent: 0, above3Percent: 0, above5Percent: 0, above10Percent: 0 };

                for (let i = 0; i < contourSize; i++) {
                    const cnt = contours.get(i);
                    if (!cnt) {
                        continue;
                    }
                    validContourCount++;

                    const area = window.cv.contourArea(cnt);
                    const areaPercent = (area / (width * height)) * 100;

                    // 面積統計を記録
                    if (areaPercent > areaStats.max) areaStats.max = areaPercent;
                    if (areaPercent < areaStats.min) areaStats.min = areaPercent;
                    if (areaPercent >= 1.0) areaStats.above1Percent++;
                    if (areaPercent >= 2.0) areaStats.above2Percent++;
                    if (areaPercent >= 3.0) areaStats.above3Percent++;
                    if (areaPercent >= 5.0) areaStats.above5Percent++;
                    if (areaPercent >= 10.0) areaStats.above10Percent++;

                    // 面積フィルタリング：0.1%以上（レシートが小さすぎる場合は除外、感度を大幅に向上）
                    if (areaPercent < 0.1 || areaPercent > 80.0) {
                        cnt.delete();
                        continue;
                    }

                    // アスペクト比によるフィルタリング：正方形（顔）を除外し、長方形（レシート）を狙う
                    const rotatedRect = window.cv.minAreaRect(cnt);
                    const rectWidth = rotatedRect.size.width;
                    const rectHeight = rotatedRect.size.height;
                    const aspectRatio = rectWidth > rectHeight ? rectWidth / rectHeight : rectHeight / rectWidth;

                    // 正方形に近いもの（顔）を即座に捨て、長方形（レシート）のみを残す
                    // aspectRatio > 1.1 || aspectRatio < 0.9 の条件で、正方形に近いものを除外（さらに緩和して検出感度向上）
                    if (aspectRatio <= 1.1 && aspectRatio >= 0.9) {
                        cnt.delete();
                        continue;
                    }

                    // 画面上部10%を無視：画面の最上部には通常、顔や背景がある（さらに緩和して検出感度向上）
                    const centerY = rotatedRect.center.y;
                    if (centerY < height * 0.1) {
                        cnt.delete();
                        continue;
                    }

                    // 画面の中央付近にある輪郭を優先：画面の端（上下左右2%以内）に触れているものは無視（さらに緩和して検出感度向上）
                    const centerX = rotatedRect.center.x;
                    const marginX = width * 0.02;
                    const marginY = height * 0.02;
                    if (centerX < marginX || centerX > width - marginX ||
                        centerY < marginY || centerY > height - marginY) {
                        cnt.delete();
                        continue;
                    }

                    // 面積の絶対評価：最大の面積を持つものを選ぶ
                    const totalScore = areaPercent;

                    largeContourCount++;

                    // 最大スコアの輪郭のインデックスを保存
                    if (totalScore > maxScore) {
                        maxScore = totalScore;
                        maxArea = area;
                        bestContourIndex = i;
                    }

                    // bestContourでない輪郭は削除
                    if (bestContourIndex !== i) {
                        cnt.delete();
                    }
                }

                // HSV Matは使用していないため削除不要

                // デバッグログ（検出状況を詳細に記録）
                if (Math.random() < 0.5 || largeContourCount === 0 || bestContourIndex < 0) {
                    console.log('[Detection] Contours:', {
                        total: contourSize,
                        valid: validContourCount,
                        large: largeContourCount,
                        bestIndex: bestContourIndex,
                        bestArea: maxArea > 0 ? ((maxArea / (width * height)) * 100).toFixed(2) + '%' : 'N/A',
                        areaStats: {
                            min: areaStats.min === Infinity ? 'N/A' : areaStats.min.toFixed(2) + '%',
                            max: areaStats.max === 0 ? 'N/A' : areaStats.max.toFixed(2) + '%',
                            above1Percent: areaStats.above1Percent,
                            above2Percent: areaStats.above2Percent,
                            above3Percent: areaStats.above3Percent,
                            above5Percent: areaStats.above5Percent
                        },
                        filters: {
                            minArea: '0.1%',
                            aspectRatio: '1.1-0.9以外',
                            topMargin: '10%',
                            edgeMargin: '2%'
                        }
                    });
                }

                // 4. 最大の白い塊を無条件で拾う：convexHull → approxPolyDP
                if (bestContourIndex >= 0) {
                    bestContour = contours.get(bestContourIndex);
                    if (bestContour) {
                        try {
                            // まずconvexHullを実行して輪郭を滑らかにする
                            const hull = new window.cv.Mat();
                            window.cv.convexHull(bestContour, hull, false, true);

                            // convexHullに対してapproxPolyDPを実行
                            // 近似精度を緩和：多少角が丸くても「四角形」として強引に認識
                            const peri = window.cv.arcLength(hull, true);
                            const epsilon = 0.02 * peri; // 0.02に固定して精度を緩和
                            const approx = new window.cv.Mat();
                            window.cv.approxPolyDP(hull, approx, epsilon, true);
                            const vertexCount = approx.rows;

                            let points: Array<{ x: number; y: number }> = [];

                            if (vertexCount === 4) {
                                // 4点が見つかった場合はそのまま使用
                                for (let j = 0; j < 4; j++) {
                                    const point = approx.intPtr(j);
                                    points.push({
                                        x: point[0] / width,
                                        y: point[1] / height
                                    });
                                }
                                approx.delete();
                                hull.delete();

                                if (Math.random() < 0.1) {
                                    console.log('[Detection] Found 4 vertices using convexHull + approxPolyDP');
                                }
                            } else {
                                // 4点が見つからない場合：minAreaRectで強制的に4角を取得
                                approx.delete();

                                if (Math.random() < 0.1) {
                                    console.log('[Detection] Vertex count:', vertexCount, 'using convexHull + minAreaRect');
                                }

                                // convexHullからminAreaRectを計算
                                const rotatedRect = window.cv.minAreaRect(hull);
                                hull.delete();

                                // RotatedRectから4つの角を計算（boxPointsはOpenCV.jsでサポートされていないため手動計算）
                                // RotatedRect: {center: {x, y}, size: {width, height}, angle: degrees}
                                const centerX = rotatedRect.center.x;
                                const centerY = rotatedRect.center.y;
                                const rectWidth = rotatedRect.size.width;
                                const rectHeight = rotatedRect.size.height;
                                const angle = rotatedRect.angle * Math.PI / 180; // 度をラジアンに変換

                                // 4つの角の相対座標（中心を原点とした場合）
                                const corners = [
                                    { x: -rectWidth / 2, y: -rectHeight / 2 },
                                    { x: rectWidth / 2, y: -rectHeight / 2 },
                                    { x: rectWidth / 2, y: rectHeight / 2 },
                                    { x: -rectWidth / 2, y: rectHeight / 2 }
                                ];

                                // 回転を適用して絶対座標に変換
                                for (const corner of corners) {
                                    const rotatedX = corner.x * Math.cos(angle) - corner.y * Math.sin(angle) + centerX;
                                    const rotatedY = corner.x * Math.sin(angle) + corner.y * Math.cos(angle) + centerY;
                                    points.push({
                                        x: rotatedX / width,
                                        y: rotatedY / height
                                    });
                                }
                            }

                            // 時計回りにソート
                            bestCorners = sortCornersClockwise(points);

                            if (bestCorners && bestCorners.length === 4 && Math.random() < 0.1) {
                                console.log('[Detection] Successfully detected corners:', bestCorners);
                            }
                        } catch (error) {
                            console.error('[Detection] Error processing best contour:', error);
                        } finally {
                            // bestContourを削除
                            if (bestContour && !bestContour.isDeleted()) {
                                bestContour.delete();
                            }
                        }
                    } else {
                        console.warn('[Detection] bestContour is null at index:', bestContourIndex);
                    }
                } else {
                    if (Math.random() < 0.1) {
                        console.log('[Detection] No valid contour found (bestContourIndex:', bestContourIndex, ')');
                    }
                }

                // メモリを解放
                src.delete();
                gray.delete();
                processedBinary.delete();
                contours.delete();
                hierarchy.delete();

                return bestCorners;
            } catch (error) {
                console.error('OpenCV detection error:', error);
                // エラー時もメモリを確実に解放
                try {
                    if (src && !src.isDeleted()) src.delete();
                    if (gray && !gray.isDeleted()) gray.delete();
                    if (thresholded && !thresholded.isDeleted()) thresholded.delete();
                    if (morphed && !morphed.isDeleted()) morphed.delete();
                    if (morphKernel && !morphKernel.isDeleted()) morphKernel.delete();
                    if (edges && !edges.isDeleted()) edges.delete();
                    if (contours && !contours.isDeleted()) contours.delete();
                    if (hierarchy && !hierarchy.isDeleted()) hierarchy.delete();
                } catch (cleanupError) {
                    console.error('Error during cleanup:', cleanupError);
                }
                return null;
            }
        } catch (error) {
            console.error('Receipt detection error:', error);
            return null;
        }
    }, [isOpenCvReady, sortCornersClockwise]);

    /**
     * requestAnimationFrameを使用したリアルタイム検出ループ
     * videoRefの映像を1フレームごとにprocessVideo関数で解析する
     */
    const startRealtimeDetection = useCallback(() => {
        // OpenCV.jsの初期化チェック
        if (!isOpenCvReady) {
            console.warn('[Detection] OpenCV.js is not ready');
            return;
        }

        if (!videoRef.current) {
            console.warn('[Detection] Video ref is not available');
            return;
        }

        // 既に検出ループが実行中の場合は、新しいループを開始しない
        if (detectionAnimationFrameRef.current !== null) {
            console.log('[Detection] Detection loop already running, skipping');
            return;
        }

        console.log('[Detection] Starting realtime detection loop');
        let frameCount = 0;

        /**
         * requestAnimationFrameで呼び出される検出ループ
         */
        const detectLoop = () => {
            // カメラが停止している場合はループを終了
            if (!videoRef.current || !isCameraActive) {
                console.log('[Detection] Stopping detection loop');
                detectionAnimationFrameRef.current = null;
                stableFrameCountRef.current = 0;
                return;
            }

            const video = videoRef.current;
            frameCount++;

            // ビデオが準備できているかチェック
            if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
                try {
                    // processVideo関数でビデオフレームを解析（毎フレーム実行）
                    const corners = processVideo(video);

                    // デバッグログ（30フレームごと）
                    if (frameCount % 30 === 0) {
                        console.log('[Detection] Frame:', frameCount, 'Video:', video.videoWidth, 'x', video.videoHeight, 'Corners:', corners ? 'detected' : 'none');
                    }

                    if (corners && corners.length === 4) {
                        // 重心を計算
                        const centroid = {
                            x: corners.reduce((sum, p) => sum + p.x, 0) / 4,
                            y: corners.reduce((sum, p) => sum + p.y, 0) / 4
                        };

                        // 過去5フレームのコーナー履歴を更新（移動平均用）
                        cornersHistoryRef.current.push(corners);
                        if (cornersHistoryRef.current.length > 5) {
                            cornersHistoryRef.current.shift();
                        }

                        // 過去10フレームの重心履歴を更新
                        centroidHistoryRef.current.push(centroid);
                        if (centroidHistoryRef.current.length > 10) {
                            centroidHistoryRef.current.shift();
                        }

                        // 移動平均を計算（過去5フレーム）
                        const avgCorners: Array<{ x: number; y: number }> = [];
                        for (let i = 0; i < 4; i++) {
                            avgCorners.push({
                                x: cornersHistoryRef.current.reduce((sum, c) => sum + c[i].x, 0) / cornersHistoryRef.current.length,
                                y: cornersHistoryRef.current.reduce((sum, c) => sum + c[i].y, 0) / cornersHistoryRef.current.length
                            });
                        }

                        // 重心の移動をチェック（過去10フレームで5px以内か）
                        let isCentroidStable = false;
                        if (centroidHistoryRef.current.length >= 10) {
                            const recentCentroids = centroidHistoryRef.current.slice(-10);
                            const firstCentroid = recentCentroids[0];
                            const lastCentroid = recentCentroids[recentCentroids.length - 1];
                            const pixelWidth = video.videoWidth;
                            const pixelHeight = video.videoHeight;
                            const dx = Math.abs(lastCentroid.x - firstCentroid.x) * pixelWidth;
                            const dy = Math.abs(lastCentroid.y - firstCentroid.y) * pixelHeight;
                            const distance = Math.sqrt(dx * dx + dy * dy);
                            isCentroidStable = distance <= 5; // 5px以内
                        }

                        // 突然の変化を無視（前フレームとの差が大きすぎる場合は移動平均を使用）
                        let finalCorners = corners;
                        if (lastDetectedCornersRef.current) {
                            let hasSuddenChange = false;
                            for (let i = 0; i < 4; i++) {
                                const dx = Math.abs(corners[i].x - lastDetectedCornersRef.current![i].x);
                                const dy = Math.abs(corners[i].y - lastDetectedCornersRef.current![i].y);
                                if (dx > 0.1 || dy > 0.1) { // 10%以上の変化は突然の変化とみなす
                                    hasSuddenChange = true;
                                    break;
                                }
                            }
                            if (hasSuddenChange && cornersHistoryRef.current.length >= 3) {
                                // 突然の変化がある場合は移動平均を使用
                                finalCorners = avgCorners;
                            }
                        }

                        // 安定化判定: 連続フレーム数をカウント
                        stableFrameCountRef.current++;
                        // 検出が成功した場合、連続失敗カウントをリセット
                        consecutiveFailuresRef.current = 0;

                        // 表示用のコーナーを更新（検出が成功したら即座に表示）
                        lastDetectedCornersRef.current = finalCorners;
                        detectedCornersRef.current = finalCorners;
                        setDetectedCorners(finalCorners);

                        if (frameCount % 30 === 0 || Math.random() < 0.1) {
                            console.log('[Detection] Setting detected corners:', finalCorners, 'frame:', frameCount, 'centroidStable:', isCentroidStable, 'stableCount:', stableFrameCountRef.current);
                        }

                        // 自動キャプチャ条件: 4頂点が検出され、重心の移動が5px以内で10フレーム続いたら0.3秒後に自動キャプチャ
                        if (isCentroidStable && stableFrameCountRef.current >= STABLE_FRAME_THRESHOLD) {
                            const now = Date.now();
                            if (stableDetectionStartRef.current === null) {
                                stableDetectionStartRef.current = now;
                                if (frameCount % 30 === 0) {
                                    console.log('[Detection] Stable detection started, waiting 0.3s for auto-capture');
                                }
                            } else if (now - stableDetectionStartRef.current >= 300) {
                                // 0.3秒間安定していたら自動キャプチャ
                                console.log('[Detection] Auto capture triggered after 0.3s stable detection');
                                stableDetectionStartRef.current = null;
                                stableFrameCountRef.current = 0;
                                cornersHistoryRef.current = [];
                                centroidHistoryRef.current = [];
                                // 検出ループを一時停止してからキャプチャ
                                if (detectionAnimationFrameRef.current !== null) {
                                    cancelAnimationFrame(detectionAnimationFrameRef.current);
                                    detectionAnimationFrameRef.current = null;
                                }
                                // capturePhoto関数を呼び出す（detectedCornersは既に設定されている）
                                capturePhoto();
                                return;
                            }
                        } else {
                            // 安定条件を満たしていない場合はリセット
                            stableDetectionStartRef.current = null;
                        }
                    } else {
                        // レシートが検知できない場合
                        stableFrameCountRef.current = 0;
                        stableDetectionStartRef.current = null;
                        cornersHistoryRef.current = [];
                        centroidHistoryRef.current = [];
                        // 検出が失敗した場合でも、すぐにはクリアしない（連続で失敗した場合のみクリア）
                        // これにより、検出が不安定な場合でも枠が消えにくくなる
                        consecutiveFailuresRef.current++;
                        if (consecutiveFailuresRef.current >= 10) {
                            // 10フレーム連続で検出が失敗した場合のみクリア
                            if (lastDetectedCornersRef.current || detectedCornersRef.current) {
                                lastDetectedCornersRef.current = null;
                                detectedCornersRef.current = null;
                                setDetectedCorners(null);
                            }
                            consecutiveFailuresRef.current = 0;
                        }
                    }
                } catch (error) {
                    console.error('[Detection] Error in detection loop:', error);
                    stableFrameCountRef.current = 0;
                    stableDetectionStartRef.current = null;
                    cornersHistoryRef.current = [];
                    centroidHistoryRef.current = [];
                    // エラー時も前回の検出結果をクリア
                    if (lastDetectedCornersRef.current || detectedCornersRef.current) {
                        lastDetectedCornersRef.current = null;
                        detectedCornersRef.current = null;
                        setDetectedCorners(null);
                    }
                }
            }

            // 次のフレームをリクエスト
            detectionAnimationFrameRef.current = requestAnimationFrame(detectLoop);
        };

        console.log('[Detection] Starting realtime detection loop');
        detectionAnimationFrameRef.current = requestAnimationFrame(detectLoop);
    }, [isOpenCvReady, isCameraActive, processVideo]);

    // リアルタイム検出を開始するuseEffect（detectReceiptとstartRealtimeDetectionが定義された後に実行）
    useEffect(() => {
        if (!isCameraActive || !isOpenCvReady || !videoRef.current) {
            // カメラが非アクティブになった場合、検出状態をリセット
            if (!isCameraActive) {
                lastDetectedCornersRef.current = null;
                detectedCornersRef.current = null;
                setDetectedCorners(null);
                cornersHistoryRef.current = [];
                centroidHistoryRef.current = [];
                stableFrameCountRef.current = 0;
                stableDetectionStartRef.current = null;
            }
            return;
        }

        // ビデオが準備できるまで待つ
        const startDetection = () => {
            if (videoRef.current && videoRef.current.readyState >= 2) {
                console.log('Starting realtime detection');
                // 検出状態をリセットしてから開始
                lastDetectedCornersRef.current = null;
                detectedCornersRef.current = null;
                setDetectedCorners(null);
                cornersHistoryRef.current = [];
                centroidHistoryRef.current = [];
                stableFrameCountRef.current = 0;
                stableDetectionStartRef.current = null;
                startRealtimeDetection();
            } else {
                // ビデオが準備できるまで待つ
                const checkReady = setInterval(() => {
                    if (videoRef.current && videoRef.current.readyState >= 2) {
                        console.log('Video ready, starting detection');
                        clearInterval(checkReady);
                        // 検出状態をリセットしてから開始
                        lastDetectedCornersRef.current = null;
                        detectedCornersRef.current = null;
                        setDetectedCorners(null);
                        cornersHistoryRef.current = [];
                        centroidHistoryRef.current = [];
                        stableFrameCountRef.current = 0;
                        stableDetectionStartRef.current = null;
                        startRealtimeDetection();
                    }
                }, 100);

                // 5秒でタイムアウト
                setTimeout(() => {
                    clearInterval(checkReady);
                }, 5000);
            }
        };

        setTimeout(startDetection, 500);

        return () => {
            // クリーンアップ
            if (detectionAnimationFrameRef.current !== null) {
                cancelAnimationFrame(detectionAnimationFrameRef.current);
                detectionAnimationFrameRef.current = null;
            }
        };
    }, [isCameraActive, isOpenCvReady, startRealtimeDetection]);

    // 検出したレシートの座標を使用して自動キャプチャ
    const autoCaptureWithDetectedCorners = async (corners: Array<{ x: number; y: number }>) => {
        if (!videoRef.current || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const video = videoRef.current;
        const ctx = canvas.getContext('2d');

        if (!ctx) return;

        const imageWidth = video.videoWidth;
        const imageHeight = video.videoHeight;

        // 検出したレシートの座標を実際のピクセル座標に変換
        const receiptCorners = corners.map(corner => ({
            x: corner.x * imageWidth,
            y: corner.y * imageHeight
        }));

        // レシートの境界ボックスを計算
        const minX = Math.min(...receiptCorners.map(c => c.x));
        const maxX = Math.max(...receiptCorners.map(c => c.x));
        const minY = Math.min(...receiptCorners.map(c => c.y));
        const maxY = Math.max(...receiptCorners.map(c => c.y));

        // 10%パディングを追加（上下左右にそれぞれ10%ずつ）
        const paddingX = (maxX - minX) * 0.1;
        const paddingY = (maxY - minY) * 0.1;

        const cropX = Math.max(0, minX - paddingX);
        const cropY = Math.max(0, minY - paddingY);
        const cropWidth = Math.min(imageWidth - cropX, maxX - minX + paddingX * 2);
        const cropHeight = Math.min(imageHeight - cropY, maxY - minY + paddingY * 2);

        // 切り抜いて描画
        canvas.width = cropWidth;
        canvas.height = cropHeight;
        ctx.drawImage(
            video,
            cropX, cropY, cropWidth, cropHeight,
            0, 0, cropWidth, cropHeight
        );

        stopCamera();

        // OCR処理を開始
        setIsOcrProcessing(true);
        setOcrWarning(null);

        try {
            canvas.toBlob(async (blob) => {
                if (!blob) return;

                try {
                    const originalBlob = blob;
                    const ocrImageBlob = await compressImageIntelligently(
                        new File([blob], 'photo.jpg', { type: 'image/jpeg' })
                    );

                    const {
                        amount: extractedAmount,
                        vendor: extractedVendor,
                        date: extractedDate,
                        time: extractedTime,
                        invoice_number: extractedInvoiceNumber,
                        currency: extractedCurrency,
                        corners: apiCorners,
                        expenseCategory: extractedExpenseCategory,
                        categoryReason: extractedCategoryReason,
                        confidenceScore: extractedConfidenceScore,
                        rotation_needed,
                        hasWarning
                    } = await extractAmountFromOcr(ocrImageBlob);

                    if (hasWarning) {
                        setOcrWarning('金額を確認してください。読み取り精度が低い可能性があります。');
                        setTimeout(() => setOcrWarning(null), 5000);
                    }

                    let finalImageBlob = originalBlob;
                    if (apiCorners && apiCorners.length === 4) {
                        try {
                            finalImageBlob = await applyPerspectiveCorrection(
                                originalBlob,
                                apiCorners,
                                imageWidth,
                                imageHeight
                            );
                        } catch (correctionError) {
                            console.warn('Failed to apply perspective correction:', correctionError);
                        }
                    }

                    // テキストの向きに基づいて画像を回転
                    if (rotation_needed !== undefined && rotation_needed !== null && rotation_needed !== 0) {
                        try {
                            finalImageBlob = await rotateImageForTextOrientation(finalImageBlob, rotation_needed);
                        } catch (rotationError) {
                            console.warn('Failed to rotate image for text orientation:', rotationError);
                        }
                    }

                    let receiptDate: Date | undefined = undefined;
                    if (extractedDate) {
                        try {
                            const dateParts = extractedDate.split('/');
                            if (dateParts.length === 3) {
                                const year = parseInt(dateParts[0], 10);
                                const month = parseInt(dateParts[1], 10);
                                const day = parseInt(dateParts[2], 10);

                                if (extractedTime) {
                                    const timeParts = extractedTime.split(':');
                                    if (timeParts.length >= 2) {
                                        const hours = parseInt(timeParts[0], 10);
                                        const minutes = parseInt(timeParts[1], 10);
                                        receiptDate = new Date(year, month - 1, day, hours || 0, minutes || 0);
                                    } else {
                                        receiptDate = new Date(year, month - 1, day);
                                    }
                                } else {
                                    receiptDate = new Date(year, month - 1, day);
                                }
                            }
                        } catch (dateError) {
                            console.warn('Failed to parse receipt date:', dateError);
                        }
                    }

                    const db = getDb();
                    if (!db) {
                        alert('データベースにアクセスできません。ページを再読み込みしてください。');
                        return;
                    }

                    const receipt: Receipt = {
                        image: finalImageBlob,
                        timestamp: new Date(),
                        note: '',
                        amount: extractedAmount,
                        vendor: extractedVendor,
                        date: extractedDate,
                        time: extractedTime,
                        receiptDate: receiptDate,
                        invoice_number: extractedInvoiceNumber,
                        currency: extractedCurrency || 'JPY',
                        corners: apiCorners,
                        expenseCategory: (extractedExpenseCategory ?? '雑費') as ExpenseCategory,
                        categoryReason: extractedCategoryReason,
                        confidenceScore: extractedConfidenceScore,
                    };

                    await db.receipts.add(receipt);
                    await loadReceipts();
                } catch (error) {
                    console.error('Failed to save receipt:', error);
                    alert('画像の保存に失敗しました');
                } finally {
                    setIsOcrProcessing(false);
                }
            }, 'image/jpeg');
        } catch (error) {
            console.error('Failed to capture photo:', error);
            alert('写真の撮影に失敗しました');
            setIsOcrProcessing(false);
        }
    };

    // レシートの面積を計算する関数（画面に対する割合）
    const calculateReceiptArea = useCallback((corners: Array<{ x: number; y: number }> | null, videoWidth: number, videoHeight: number): number => {
        if (!corners || corners.length !== 4) return 0;

        // 正規化された座標（0-1）を実際のピクセル座標に変換
        const pixelCorners = corners.map(corner => ({
            x: corner.x * videoWidth,
            y: corner.y * videoHeight
        }));

        // レシートの境界ボックスを計算
        const minX = Math.min(...pixelCorners.map(c => c.x));
        const maxX = Math.max(...pixelCorners.map(c => c.x));
        const minY = Math.min(...pixelCorners.map(c => c.y));
        const maxY = Math.max(...pixelCorners.map(c => c.y));

        // 面積を計算（パディング20%を含む）
        const width = maxX - minX;
        const height = maxY - minY;
        const area = width * height * 1.2 * 1.2; // 20%パディングを考慮

        // 画面全体の面積に対する割合を計算
        const totalArea = videoWidth * videoHeight;
        return (area / totalArea) * 100; // パーセンテージで返す
    }, []);

    // レシート検出の面積が十分かチェック
    const isReceiptAreaValid = useMemo(() => {
        if (!detectedCorners || !videoRef.current) return false;
        const video = videoRef.current;
        if (video.videoWidth === 0 || video.videoHeight === 0) return false;

        const areaPercent = calculateReceiptArea(detectedCorners, video.videoWidth, video.videoHeight);
        return areaPercent >= 5; // 画面の5%以上（検出感度を向上）
    }, [detectedCorners, calculateReceiptArea]);

    // レシートのアスペクト比を計算（横倒し判定用）
    const receiptAspectRatio = useMemo(() => {
        if (!detectedCorners || !videoRef.current) return null;
        const video = videoRef.current;
        if (video.videoWidth === 0 || video.videoHeight === 0) return null;

        // 正規化座標（0-1）を実際のピクセル座標に変換
        const pixelCorners = detectedCorners.map(corner => ({
            x: corner.x * video.videoWidth,
            y: corner.y * video.videoHeight
        }));

        // 4点から幅と高さを計算
        const topWidth = Math.sqrt(
            Math.pow(pixelCorners[1].x - pixelCorners[0].x, 2) +
            Math.pow(pixelCorners[1].y - pixelCorners[0].y, 2)
        );
        const bottomWidth = Math.sqrt(
            Math.pow(pixelCorners[2].x - pixelCorners[3].x, 2) +
            Math.pow(pixelCorners[2].y - pixelCorners[3].y, 2)
        );
        const leftHeight = Math.sqrt(
            Math.pow(pixelCorners[3].x - pixelCorners[0].x, 2) +
            Math.pow(pixelCorners[3].y - pixelCorners[0].y, 2)
        );
        const rightHeight = Math.sqrt(
            Math.pow(pixelCorners[2].x - pixelCorners[1].x, 2) +
            Math.pow(pixelCorners[2].y - pixelCorners[1].y, 2)
        );

        const W = (topWidth + bottomWidth) / 2;
        const H = (leftHeight + rightHeight) / 2;

        return W / H; // 幅/高さの比率（1より大きいと横長）
    }, [detectedCorners]);

    // レシートが横倒しかどうかを判定（アスペクト比が1.3以上の場合）
    const isReceiptLandscape = useMemo(() => {
        return receiptAspectRatio !== null && receiptAspectRatio > 1.3;
    }, [receiptAspectRatio]);

    const capturePhoto = useCallback(async () => {
        if (!videoRef.current || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const video = videoRef.current;
        const ctx = canvas.getContext('2d');

        if (!ctx) return;

        // 撮影前チェック：レシートが横倒しの場合に警告
        if (detectedCorners && detectedCorners.length === 4 && isReceiptLandscape) {
            const shouldProceed = window.confirm('レシートが横倒しになっている可能性があります。\n文字が水平に読めるように撮影してください。\n\nそれでも撮影を続けますか？');
            if (!shouldProceed) {
                return;
            }
        }

        const imageWidth = video.videoWidth;
        const imageHeight = video.videoHeight;

        // 検出されたレシートの座標を使用するか、デフォルトのガイド枠を使用するか
        let cropX: number, cropY: number, cropWidth: number, cropHeight: number;

        if (detectedCorners && detectedCorners.length === 4) {
            // 検出されたレシートの座標を使用
            const receiptCorners = detectedCorners.map(corner => ({
                x: corner.x * imageWidth,
                y: corner.y * imageHeight
            }));

            const minX = Math.min(...receiptCorners.map(c => c.x));
            const maxX = Math.max(...receiptCorners.map(c => c.x));
            const minY = Math.min(...receiptCorners.map(c => c.y));
            const maxY = Math.max(...receiptCorners.map(c => c.y));

            // 10%パディングを追加（上下左右にそれぞれ10%ずつ）
            const paddingX = (maxX - minX) * 0.1;
            const paddingY = (maxY - minY) * 0.1;

            cropX = Math.max(0, minX - paddingX);
            cropY = Math.max(0, minY - paddingY);
            cropWidth = Math.min(imageWidth - cropX, maxX - minX + paddingX * 2);
            cropHeight = Math.min(imageHeight - cropY, maxY - minY + paddingY * 2);
        } else {
            // デフォルトのガイド枠を使用
            const isMobile = isMobileDevice();
            const guideSizePercent = isMobile ? 0.85 : 0.70;
            const guideSize = Math.min(window.innerWidth * guideSizePercent, window.innerHeight * guideSizePercent);
            const guideLeft = (window.innerWidth - guideSize) / 2;
            const guideTop = (window.innerHeight - guideSize) / 2;

            const videoRect = video.getBoundingClientRect();
            const scaleX = imageWidth / videoRect.width;
            const scaleY = imageHeight / videoRect.height;

            const marginPercent = 0.05;
            cropX = Math.max(0, (guideLeft - videoRect.left) * scaleX - (guideSize * scaleX * marginPercent));
            cropY = Math.max(0, (guideTop - videoRect.top) * scaleY - (guideSize * scaleY * marginPercent));
            cropWidth = Math.min(imageWidth - cropX, guideSize * scaleX * (1 + marginPercent * 2));
            cropHeight = Math.min(imageHeight - cropY, guideSize * scaleY * (1 + marginPercent * 2));
        }

        // 画像を切り抜いて描画
        canvas.width = cropWidth;
        canvas.height = cropHeight;
        ctx.drawImage(
            video,
            cropX, cropY, cropWidth, cropHeight,
            0, 0, cropWidth, cropHeight
        );

        stopCamera();

        // プレビュー画像を表示し、自動的にOCR解析を開始
        canvas.toBlob(async (blob) => {
            if (blob) {
                console.log('Setting preview image, blob size:', blob.size, 'type:', blob.type);
                setPreviewImage({
                    blob: blob,
                    corners: detectedCorners
                });
                console.log('Preview image state set');

                // 自動的にOCR解析を開始（1回のタップで完了）
                try {
                    setIsOcrProcessing(true);
                    setOcrWarning(null);

                    // OCR用にインテリジェントな圧縮
                    const ocrImageBlob = await compressImageIntelligently(
                        new File([blob], 'photo.jpg', { type: 'image/jpeg' })
                    );

                    // OCRで情報を抽出（状態更新は既に実行済みなのでスキップ）
                    const {
                        amount: extractedAmount,
                        vendor: extractedVendor,
                        date: extractedDate,
                        time: extractedTime,
                        invoice_number: extractedInvoiceNumber,
                        currency: extractedCurrency,
                        corners: ocrCorners,
                        expenseCategory: extractedExpenseCategory,
                        categoryReason: extractedCategoryReason,
                        confidenceScore: extractedConfidenceScore,
                        rotation_needed,
                        hasWarning
                    } = await extractAmountFromOcr(ocrImageBlob, true);

                    if (hasWarning) {
                        setOcrWarning('金額を確認してください。読み取り精度が低い可能性があります。');
                        setTimeout(() => setOcrWarning(null), 5000);
                    }

                    // 文字の向きチェック：rotation_neededが0以外の場合に警告
                    if (rotation_needed !== undefined && rotation_needed !== null && rotation_needed !== 0) {
                        setOcrWarning('文字の向きを確認してください。画像が回転して保存されます。');
                        setTimeout(() => setOcrWarning(null), 5000);
                    }

                    // 台形補正を適用（OCRで検出されたcornersを優先、なければdetectedCornersを使用）
                    const cornersToUse: Array<{ x: number; y: number }> | null = ocrCorners && ocrCorners.length === 4 ? ocrCorners : detectedCorners;
                    let finalImageBlob = blob;
                    if (cornersToUse && cornersToUse.length === 4) {
                        try {
                            const correctionCanvas = canvasRef.current;
                            if (correctionCanvas) {
                                finalImageBlob = await applyPerspectiveCorrection(
                                    blob,
                                    cornersToUse,
                                    cropWidth,
                                    cropHeight
                                );
                            }
                        } catch (correctionError) {
                            console.warn('Failed to apply perspective correction:', correctionError);
                        }
                    }

                    // テキストの向きに基づいて画像を回転
                    if (rotation_needed !== undefined && rotation_needed !== null && rotation_needed !== 0) {
                        try {
                            finalImageBlob = await rotateImageForTextOrientation(finalImageBlob, rotation_needed);
                        } catch (rotationError) {
                            console.warn('Failed to rotate image for text orientation:', rotationError);
                        }
                    }

                    // receiptDateを計算
                    let receiptDate: Date | undefined = undefined;
                    if (extractedDate) {
                        try {
                            const dateParts = extractedDate.split('/');
                            if (dateParts.length === 3) {
                                const year = parseInt(dateParts[0], 10);
                                const month = parseInt(dateParts[1], 10);
                                const day = parseInt(dateParts[2], 10);

                                if (extractedTime) {
                                    const timeParts = extractedTime.split(':');
                                    if (timeParts.length >= 2) {
                                        const hours = parseInt(timeParts[0], 10);
                                        const minutes = parseInt(timeParts[1], 10);
                                        receiptDate = new Date(year, month - 1, day, hours || 0, minutes || 0);
                                    } else {
                                        receiptDate = new Date(year, month - 1, day);
                                    }
                                } else {
                                    receiptDate = new Date(year, month - 1, day);
                                }
                            }
                        } catch (dateError) {
                            console.warn('Failed to parse receipt date:', dateError);
                        }
                    }

                    const db = getDb();
                    if (!db) {
                        alert('データベースにアクセスできません。ページを再読み込みしてください。');
                        return;
                    }

                    const receipt: Receipt = {
                        image: finalImageBlob,
                        timestamp: new Date(),
                        note: '',
                        amount: extractedAmount,
                        vendor: extractedVendor,
                        date: extractedDate,
                        time: extractedTime,
                        receiptDate: receiptDate,
                        invoice_number: extractedInvoiceNumber,
                        currency: extractedCurrency || 'JPY',
                        corners: cornersToUse ?? undefined,
                        expenseCategory: (extractedExpenseCategory ?? '雑費') as ExpenseCategory,
                        categoryReason: extractedCategoryReason,
                        confidenceScore: extractedConfidenceScore,
                    };

                    await db.receipts.add(receipt);
                    await loadReceipts();

                    // プレビューをクリア
                    setPreviewImage(null);
                } catch (error) {
                    console.error('Failed to process receipt:', error);
                    // エラーが発生してもプレビューは表示したまま（手動で再試行可能）
                    setOcrWarning('解析に失敗しました。もう一度お試しください。');
                    setTimeout(() => setOcrWarning(null), 5000);
                } finally {
                    setIsOcrProcessing(false);
                }
            } else {
                console.error('Failed to create blob from canvas');
            }
        }, 'image/jpeg', 0.95); // 高品質で保存
    }, [detectedCorners, stopCamera, loadReceipts]);

    // プレビュー画像からOCR解析を開始する関数
    const startOcrAnalysis = async () => {
        if (!previewImage) return;

        setIsOcrProcessing(true);
        setOcrWarning(null);

        try {
            const originalBlob = previewImage.blob;

            // OCR用にインテリジェントな圧縮
            const ocrImageBlob = await compressImageIntelligently(
                new File([originalBlob], 'photo.jpg', { type: 'image/jpeg' })
            );

            // OCRで情報を抽出
            const {
                amount: extractedAmount,
                vendor: extractedVendor,
                date: extractedDate,
                time: extractedTime,
                invoice_number: extractedInvoiceNumber,
                currency: extractedCurrency,
                corners,
                expenseCategory: extractedExpenseCategory,
                categoryReason: extractedCategoryReason,
                confidenceScore: extractedConfidenceScore,
                rotation_needed,
                hasWarning
            } = await extractAmountFromOcr(ocrImageBlob);

            if (hasWarning) {
                setOcrWarning('金額を確認してください。読み取り精度が低い可能性があります。');
                setTimeout(() => setOcrWarning(null), 5000);
            }

            // 台形補正を適用
            let finalImageBlob = originalBlob;
            if (corners && corners.length === 4) {
                try {
                    const canvas = canvasRef.current;
                    if (canvas) {
                        finalImageBlob = await applyPerspectiveCorrection(
                            originalBlob,
                            corners,
                            canvas.width,
                            canvas.height
                        );
                    }
                } catch (correctionError) {
                    console.warn('Failed to apply perspective correction:', correctionError);
                }
            }

            // テキストの向きに基づいて画像を回転
            if (rotation_needed !== undefined && rotation_needed !== null && rotation_needed !== 0) {
                try {
                    finalImageBlob = await rotateImageForTextOrientation(finalImageBlob, rotation_needed);
                } catch (rotationError) {
                    console.warn('Failed to rotate image for text orientation:', rotationError);
                }
            }

            // receiptDateを計算
            let receiptDate: Date | undefined = undefined;
            if (extractedDate) {
                try {
                    const dateParts = extractedDate.split('/');
                    if (dateParts.length === 3) {
                        const year = parseInt(dateParts[0], 10);
                        const month = parseInt(dateParts[1], 10);
                        const day = parseInt(dateParts[2], 10);

                        if (extractedTime) {
                            const timeParts = extractedTime.split(':');
                            if (timeParts.length >= 2) {
                                const hours = parseInt(timeParts[0], 10);
                                const minutes = parseInt(timeParts[1], 10);
                                receiptDate = new Date(year, month - 1, day, hours || 0, minutes || 0);
                            } else {
                                receiptDate = new Date(year, month - 1, day);
                            }
                        } else {
                            receiptDate = new Date(year, month - 1, day);
                        }
                    }
                } catch (dateError) {
                    console.warn('Failed to parse receipt date:', dateError);
                }
            }

            const db = getDb();
            if (!db) {
                alert('データベースにアクセスできません。ページを再読み込みしてください。');
                return;
            }

            const receipt: Receipt = {
                image: finalImageBlob,
                timestamp: new Date(),
                note: '',
                amount: extractedAmount,
                vendor: extractedVendor,
                date: extractedDate,
                time: extractedTime,
                receiptDate: receiptDate,
                invoice_number: extractedInvoiceNumber,
                currency: extractedCurrency || 'JPY',
                corners: corners,
                expenseCategory: extractedExpenseCategory || '雑費',
            };

            await db.receipts.add(receipt);
            await loadReceipts();

            // プレビューをクリア（URLはuseEffectで自動的に解放される）
            setPreviewImage(null);
        } catch (error) {
            console.error('Failed to process receipt:', error);
            alert('画像の処理に失敗しました');
        } finally {
            setIsOcrProcessing(false);
        }
    };

    const handleUpdateReceipt = async () => {
        if (!editingReceipt?.id) return;

        try {
            const db = getDb();
            if (!db) {
                alert('データベースにアクセスできません。ページを再読み込みしてください。');
                return;
            }
            // 日付と時刻からreceiptDateを計算
            let receiptDate: Date | undefined = undefined;
            let dateStr: string | undefined = undefined;
            let timeStr: string | undefined = undefined;

            if (editForm.date) {
                const dateParts = editForm.date.split('-');
                if (dateParts.length === 3) {
                    const year = parseInt(dateParts[0], 10);
                    const month = parseInt(dateParts[1], 10);
                    const day = parseInt(dateParts[2], 10);

                    dateStr = `${year}/${month}/${day}`;
                    receiptDate = new Date(year, month - 1, day);
                }
            }

            await db.receipts.update(editingReceipt.id, {
                vendor: editForm.vendor,
                amount: editForm.amount,
                note: editForm.note,
                date: dateStr,
                time: timeStr,
                receiptDate: receiptDate,
                expenseCategory: editForm.expenseCategory,
            });

            setEditingReceipt(null);
            setEditForm({ vendor: '', amount: 0, note: '', date: '', expenseCategory: '雑費' });
            await loadReceipts();
        } catch (error) {
            console.error('Failed to update receipt:', error);
            alert('更新に失敗しました');
        }
    };

    const openEditModal = (receipt: Receipt) => {
        setEditingReceipt(receipt);

        // 日付をフォーム用の形式に変換（時刻は編集しない）
        let dateStr = '';

        if (receipt.receiptDate) {
            // receiptDateが存在する場合はそれを使用
            const date = new Date(receipt.receiptDate);
            dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        } else if (receipt.date) {
            // date文字列が存在する場合（YYYY/MM/DD形式またはYYYY-MM-DD形式）
            const dateParts = receipt.date.includes('/')
                ? receipt.date.split('/')
                : receipt.date.split('-');
            if (dateParts.length === 3) {
                const year = dateParts[0];
                const month = dateParts[1];
                const day = dateParts[2];
                dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }
        }

        setEditForm({
            vendor: receipt.vendor || '',
            amount: receipt.amount || 0,
            note: receipt.note || '',
            date: dateStr,
            expenseCategory: (receipt.expenseCategory ?? '雑費') as ExpenseCategory,
        });
    };

    const clearAllReceipts = async () => {
        const confirmed = window.confirm('すべてのレシートデータを削除しますか？この操作は取り消せません。');
        if (!confirmed) {
            return;
        }

        try {
            const db = getDb();
            if (!db) {
                alert('データベースにアクセスできません。ページを再読み込みしてください。');
                return;
            }

            // すべてのレシートを削除
            await db.receipts.clear();
            console.log('All receipts cleared');

            // 画像URLのクリーンアップ
            imageUrlsRef.current.forEach((url) => {
                URL.revokeObjectURL(url);
            });
            imageUrlsRef.current.clear();

            // レシートリストを再読み込み
            await loadReceipts();
            console.log('Receipts reloaded after clearing');
            alert('すべてのレシートデータを削除しました。');
        } catch (error) {
            console.error('Failed to clear receipts:', error);
            alert(`データの削除に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`);
        }
    };

    const deleteReceipt = async (id: number) => {
        if (!id) {
            console.error('Delete receipt: id is undefined');
            alert('削除するレシートのIDが無効です');
            return;
        }

        // confirmダイアログを表示（モバイルでも動作するように）
        const confirmed = window.confirm('このレシートを削除しますか？');
        if (!confirmed) {
            console.log('Delete cancelled by user');
            return;
        }

        try {
            const db = getDb();
            if (!db) {
                console.error('Database not available');
                alert('データベースにアクセスできません。ページを再読み込みしてください。');
                return;
            }

            console.log('Deleting receipt with id:', id);
            await db.receipts.delete(id);
            console.log('Receipt deleted successfully');

            // 画像URLのクリーンアップ
            const imageUrl = imageUrlsRef.current.get(id);
            if (imageUrl) {
                URL.revokeObjectURL(imageUrl);
                imageUrlsRef.current.delete(id);
                console.log('Image URL revoked for id:', id);
            }

            // レシートリストを再読み込み
            await loadReceipts();
            console.log('Receipts reloaded after deletion');
        } catch (error) {
            console.error('Failed to delete receipt:', error);
            console.error('Error details:', {
                id,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            alert(`削除に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`);
        }
    };

    useEffect(() => {
        return () => {
            imageUrlsRef.current.forEach((url) => {
                URL.revokeObjectURL(url);
            });
            imageUrlsRef.current.clear();
        };
    }, []);

    const formatDate = (date: Date) => {
        const d = new Date(date);
        return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    // 勘定科目のバッジスタイルを取得
    const getExpenseCategoryBadge = (category: ExpenseCategory | undefined) => {
        const categoryStyles: Record<ExpenseCategory, { bg: string; text: string }> = {
            '仕入高': { bg: 'bg-blue-600', text: 'text-white' },
            '広告宣伝費': { bg: 'bg-blue-600', text: 'text-white' },
            '消耗品費': { bg: 'bg-gray-500', text: 'text-white' },
            '会議費': { bg: 'bg-blue-600', text: 'text-white' },
            '接待交際費': { bg: 'bg-blue-600', text: 'text-white' },
            '旅費交通費': { bg: 'bg-gray-700', text: 'text-white' },
            '通信費': { bg: 'bg-gray-500', text: 'text-white' },
            '支払手数料': { bg: 'bg-gray-700', text: 'text-white' },
            '新聞図書費': { bg: 'bg-gray-500', text: 'text-white' },
            '雑費': { bg: 'bg-gray-300', text: 'text-gray-700' },
        };
        const style = categoryStyles[category || '雑費'];
        return (
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${style.bg} ${style.text}`}>
                {category || '雑費'}
            </span>
        );
    };

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-100">
                <div className="text-gray-500">読み込み中...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-100">
                <div className="text-center">
                    <p className="text-red-600 mb-4">{error}</p>
                    <button
                        onClick={loadReceipts}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        再試行
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100 pb-20">
            {/* Header */}
            <header className="sticky top-0 z-10 bg-white border-b border-gray-300 shadow-sm">
                <div className="max-w-4xl mx-auto px-4 py-4">
                    <div className="flex items-center justify-between mb-3">
                        <h1 className="text-2xl font-bold text-gray-900">レシート管理</h1>
                        {receipts.length > 0 && (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={clearAllReceipts}
                                    className="flex items-center gap-1.5 px-3 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors shadow-sm text-sm"
                                >
                                    <X size={14} />
                                    <span>データクリア</span>
                                </button>
                                <button
                                    onClick={() => setShowExportModal(true)}
                                    className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm text-sm"
                                >
                                    <Download size={14} />
                                    <span>エクスポート</span>
                                </button>
                            </div>
                        )}
                    </div>
                    {/* 通貨別合計金額をカード形式で表示 */}
                    <div className="flex flex-wrap gap-3">
                        {Object.entries(totalAmountByCurrency).map(([currency, amount]) => (
                            <div
                                key={currency}
                                className="bg-gray-100 rounded-lg px-4 py-3 shadow-sm border border-gray-300"
                            >
                                <div className="text-xs text-gray-500 font-medium mb-1">
                                    Total {currency}
                                </div>
                                <div className="text-2xl font-bold text-blue-600">
                                    {formatAmount(amount, currency)}
                                </div>
                            </div>
                        ))}
                        {Object.keys(totalAmountByCurrency).length === 0 && (
                            <div className="bg-gray-100 rounded-lg px-4 py-3 shadow-sm border border-gray-300">
                                <div className="text-xs text-gray-500 font-medium mb-1">
                                    Total JPY
                                </div>
                                <div className="text-2xl font-bold text-gray-700">
                                    ¥0
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {/* OCR処理中のインジケーター（スキャンアニメーション付き） */}
            {isOcrProcessing && (
                <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
                    <div className="bg-white rounded-lg p-6 flex flex-col items-center gap-4 relative overflow-hidden w-full max-w-sm mx-4">
                        {/* スキャンアニメーション（切り抜いた範囲がスキャンされるような光るラインが上下に動く） */}
                        <div className="absolute inset-0 overflow-hidden rounded-lg">
                            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-600/40 to-transparent animate-scan"></div>
                            {/* 追加のスキャンライン効果 */}
                            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-600/20 to-transparent animate-scan" style={{ animationDelay: '0.5s' }}></div>
                        </div>
                        <Loader2 className="animate-spin text-blue-600 relative z-10" size={32} />
                        <p className="text-gray-900 font-medium relative z-10">画像を圧縮・送信中...</p>
                    </div>
                </div>
            )}

            {/* OCR警告メッセージ */}
            {ocrWarning && (
                <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-gray-100 border border-gray-300 rounded-lg shadow-lg p-4 max-w-md mx-4">
                    <div className="flex items-start gap-3">
                        <div className="flex-shrink-0">
                            <svg className="w-5 h-5 text-gray-700" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                        </div>
                        <div className="flex-1">
                            <p className="text-sm font-medium text-gray-700">{ocrWarning}</p>
                        </div>
                        <button
                            onClick={() => setOcrWarning(null)}
                            className="flex-shrink-0 text-gray-500 hover:text-gray-700"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>
            )}

            {/* エクスポートモーダル */}
            {showExportModal && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
                        <div className="border-b border-gray-300 px-6 py-4 flex items-center justify-between">
                            <h2 className="text-xl font-bold text-gray-900">CSVエクスポート</h2>
                            <button
                                onClick={() => setShowExportModal(false)}
                                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                            >
                                <X size={24} className="text-gray-500" />
                            </button>
                        </div>

                        <div className="p-6 space-y-6">
                            {/* エクスポート形式の選択 */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-3">
                                    エクスポート形式を選択
                                </label>
                                <div className="space-y-2">
                                    {/* 画像エクスポート */}
                                    <div className="border-t border-gray-300 pt-4 mt-4">
                                        <h3 className="text-sm font-semibold text-gray-700 mb-2">画像エクスポート</h3>
                                        <button
                                            onClick={() => exportImages(false)}
                                            className="w-full px-4 py-3 text-left border-2 border-gray-300 rounded-lg hover:border-blue-600 hover:bg-gray-100 transition-colors"
                                        >
                                            <div className="font-semibold text-gray-900">画像をZIPでエクスポート（現在表示中）</div>
                                            <div className="text-xs text-gray-500 mt-1">撮影したサイズのまま画像をZIPファイルでダウンロード</div>
                                            <div className="text-xs text-gray-500 mt-1">
                                                {groupedReceipts.sortedMonthKeys.reduce((sum, key) => sum + (groupedReceipts.grouped[key]?.length || 0), 0) + groupedReceipts.unknownDateReceipts.length}件
                                            </div>
                                        </button>
                                        <button
                                            onClick={() => exportImages(true)}
                                            className="w-full px-4 py-3 text-left border-2 border-gray-300 rounded-lg hover:border-blue-600 hover:bg-gray-100 transition-colors mt-2"
                                        >
                                            <div className="font-semibold text-gray-900">画像をZIPでエクスポート（全データ）</div>
                                            <div className="text-xs text-gray-500 mt-1">撮影したサイズのまま画像をZIPファイルでダウンロード</div>
                                            <div className="text-xs text-gray-500 mt-1">{receipts.length}件</div>
                                        </button>
                                    </div>

                                    {/* CSVエクスポート */}
                                    <div className="border-t border-gray-300 pt-4 mt-4">
                                        <h3 className="text-sm font-semibold text-gray-700 mb-2">CSVエクスポート</h3>
                                        <button
                                            onClick={() => exportToCSV('generic', false)}
                                            className="w-full px-4 py-3 text-left border-2 border-gray-300 rounded-lg hover:border-blue-600 hover:bg-gray-100 transition-colors"
                                        >
                                            <div className="font-semibold text-gray-900">汎用CSV（現在表示中）</div>
                                            <div className="text-xs text-gray-500 mt-1">日付, 店名, 金額, 通貨, 時刻, インボイス番号</div>
                                            <div className="text-xs text-gray-500 mt-1">
                                                {groupedReceipts.sortedMonthKeys.reduce((sum, key) => sum + (groupedReceipts.grouped[key]?.length || 0), 0) + groupedReceipts.unknownDateReceipts.length}件
                                            </div>
                                        </button>
                                        <button
                                            onClick={() => exportToCSV('generic', true)}
                                            className="w-full px-4 py-3 text-left border-2 border-gray-300 rounded-lg hover:border-blue-600 hover:bg-gray-100 transition-colors"
                                        >
                                            <div className="font-semibold text-gray-900">汎用CSV（全データ）</div>
                                            <div className="text-xs text-gray-500 mt-1">日付, 店名, 金額, 通貨, 時刻, インボイス番号</div>
                                            <div className="text-xs text-gray-500 mt-1">{receipts.length}件</div>
                                        </button>
                                        <button
                                            onClick={() => exportToCSV('freee', false)}
                                            className="w-full px-4 py-3 text-left border-2 border-gray-300 rounded-lg hover:border-blue-600 hover:bg-gray-100 transition-colors"
                                        >
                                            <div className="font-semibold text-gray-900">freee形式（現在表示中）</div>
                                            <div className="text-xs text-gray-500 mt-1">freee会計ソフトのインポート用形式</div>
                                            <div className="text-xs text-gray-500 mt-1">
                                                {groupedReceipts.sortedMonthKeys.reduce((sum, key) => sum + (groupedReceipts.grouped[key]?.length || 0), 0) + groupedReceipts.unknownDateReceipts.length}件
                                            </div>
                                        </button>
                                        <button
                                            onClick={() => exportToCSV('freee', true)}
                                            className="w-full px-4 py-3 text-left border-2 border-gray-300 rounded-lg hover:border-blue-600 hover:bg-gray-100 transition-colors"
                                        >
                                            <div className="font-semibold text-gray-900">freee形式（全データ）</div>
                                            <div className="text-xs text-gray-500 mt-1">freee会計ソフトのインポート用形式</div>
                                            <div className="text-xs text-gray-500 mt-1">{receipts.length}件</div>
                                        </button>
                                        <button
                                            onClick={() => exportToCSV('moneyforward', false)}
                                            className="w-full px-4 py-3 text-left border-2 border-gray-300 rounded-lg hover:border-blue-600 hover:bg-gray-100 transition-colors"
                                        >
                                            <div className="font-semibold text-gray-900">マネーフォワード形式（現在表示中）</div>
                                            <div className="text-xs text-gray-500 mt-1">マネーフォワードのインポート用形式</div>
                                            <div className="text-xs text-gray-500 mt-1">
                                                {groupedReceipts.sortedMonthKeys.reduce((sum, key) => sum + (groupedReceipts.grouped[key]?.length || 0), 0) + groupedReceipts.unknownDateReceipts.length}件
                                            </div>
                                        </button>
                                        <button
                                            onClick={() => exportToCSV('moneyforward', true)}
                                            className="w-full px-4 py-3 text-left border-2 border-gray-300 rounded-lg hover:border-blue-600 hover:bg-gray-100 transition-colors"
                                        >
                                            <div className="font-semibold text-gray-900">マネーフォワード形式（全データ）</div>
                                            <div className="text-xs text-gray-500 mt-1">マネーフォワードのインポート用形式</div>
                                            <div className="text-xs text-gray-500 mt-1">{receipts.length}件</div>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* 注意事項 */}
                            <div className="bg-gray-100 border border-gray-300 rounded-lg p-3">
                                <p className="text-xs text-gray-700">
                                    💡 各形式のボタンをクリックすると、選択した範囲のデータが即座にダウンロードされます。
                                    <br />
                                    THB（タイバーツ）のレシートは備考欄に「外貨: THB」と記載されます。
                                </p>
                            </div>
                        </div>

                        <div className="border-t border-gray-300 px-6 py-4 flex justify-end">
                            <button
                                onClick={() => setShowExportModal(false)}
                                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
                            >
                                キャンセル
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 画像拡大表示モーダル */}
            {expandedImage && (
                <div
                    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
                    onClick={() => setExpandedImage(null)}
                >
                    <div className="relative max-w-4xl max-h-[90vh] w-full h-full flex items-center justify-center">
                        <img
                            src={expandedImage.url}
                            alt={`Receipt ${expandedImage.receipt.id}`}
                            className="max-w-full max-h-full object-contain"
                            onClick={(e) => e.stopPropagation()}
                        />
                        <button
                            onClick={() => setExpandedImage(null)}
                            className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-white/30 rounded-full transition-colors backdrop-blur-sm"
                        >
                            <X size={24} className="text-white" />
                        </button>
                    </div>
                </div>
            )}

            {/* 編集モーダル */}
            {editingReceipt && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col md:flex-row">
                        {/* 左側: レシート画像（全体を表示） */}
                        <div className="w-full md:w-1/2 bg-gray-100 flex items-center justify-center p-4 overflow-auto min-h-0">
                            {(() => {
                                const imageUrl = editingReceipt.id
                                    ? (imageUrlsRef.current.get(editingReceipt.id) || URL.createObjectURL(editingReceipt.image))
                                    : URL.createObjectURL(editingReceipt.image);
                                if (editingReceipt.id && !imageUrlsRef.current.has(editingReceipt.id)) {
                                    imageUrlsRef.current.set(editingReceipt.id, imageUrl);
                                }
                                return (
                                    <img
                                        src={imageUrl}
                                        alt={`Receipt ${editingReceipt.id}`}
                                        className="w-auto h-auto max-w-full max-h-full object-contain cursor-pointer rounded-lg shadow-md"
                                        style={{ maxHeight: 'calc(90vh - 2rem)' }}
                                        onClick={() => {
                                            // 画像をタップしたら拡大表示
                                            setExpandedImage({ url: imageUrl, receipt: editingReceipt });
                                        }}
                                    />
                                );
                            })()}
                        </div>

                        {/* 右側: 編集フォーム */}
                        <div className="w-full md:w-1/2 flex flex-col max-h-[90vh] overflow-y-auto">
                            <div className="sticky top-0 bg-white border-b border-gray-300 px-6 py-4 flex items-center justify-between">
                                <h2 className="text-xl font-bold text-gray-900">レシートを編集</h2>
                                <button
                                    onClick={() => {
                                        setEditingReceipt(null);
                                        setEditForm({ vendor: '', amount: 0, note: '', date: '', expenseCategory: '雑費' });
                                    }}
                                    className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                                >
                                    <X size={24} className="text-gray-500" />
                                </button>
                            </div>

                            <div className="p-6 space-y-4 flex-1">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        店名
                                    </label>
                                    <input
                                        type="text"
                                        value={editForm.vendor}
                                        onChange={(e) => setEditForm({ ...editForm, vendor: e.target.value })}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent text-gray-900 placeholder:text-gray-500"
                                        style={{
                                            fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"'
                                        }}
                                        placeholder="店名を入力"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        金額
                                    </label>
                                    <input
                                        type="number"
                                        value={editForm.amount || ''}
                                        onChange={(e) => setEditForm({ ...editForm, amount: parseFloat(e.target.value) || 0 })}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent text-gray-900 placeholder:text-gray-500"
                                        placeholder="0"
                                        min="0"
                                        step="1"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        日付
                                    </label>
                                    <input
                                        type="date"
                                        value={editForm.date}
                                        onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent text-gray-900 placeholder:text-gray-500"
                                        style={{
                                            fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"'
                                        }}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        勘定科目
                                    </label>
                                    <select
                                        value={editForm.expenseCategory}
                                        onChange={(e) => setEditForm({ ...editForm, expenseCategory: e.target.value as ExpenseCategory })}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent text-gray-900 bg-white"
                                    >
                                        <option value="仕入高">仕入高</option>
                                        <option value="広告宣伝費">広告宣伝費</option>
                                        <option value="消耗品費">消耗品費</option>
                                        <option value="会議費">会議費</option>
                                        <option value="接待交際費">接待交際費</option>
                                        <option value="旅費交通費">旅費交通費</option>
                                        <option value="通信費">通信費</option>
                                        <option value="支払手数料">支払手数料</option>
                                        <option value="新聞図書費">新聞図書費</option>
                                        <option value="雑費">雑費</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        メモ
                                    </label>
                                    <textarea
                                        value={editForm.note}
                                        onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent resize-none text-gray-900 placeholder:text-gray-500"
                                        placeholder="メモを入力"
                                        rows={4}
                                    />
                                </div>
                            </div>

                            <div className="sticky bottom-0 bg-gray-100 border-t border-gray-300 px-6 py-4 flex gap-3">
                                <button
                                    onClick={() => {
                                        setEditingReceipt(null);
                                        setEditForm({ vendor: '', amount: 0, note: '', date: '', expenseCategory: '雑費' });
                                    }}
                                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
                                >
                                    キャンセル
                                </button>
                                <button
                                    onClick={handleUpdateReceipt}
                                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                                >
                                    保存
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Camera Modal */}
            {isCameraActive && (
                <div className="fixed inset-0 z-50 bg-black flex flex-col">
                    <div className="flex-1 relative overflow-hidden">
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover"
                            style={{ objectFit: 'cover' }}
                            onLoadedMetadata={(e) => {
                                e.currentTarget.play().catch((err) => {
                                    console.error('Failed to play video:', err);
                                });
                            }}
                        />
                        {/* デバッグ用：二値化画像を表示するCanvas（画面の右下隅） */}
                        <canvas
                            ref={debugCanvasRef}
                            className="absolute bottom-4 right-4 border-2 border-white/50 rounded-lg shadow-lg z-30"
                            style={{
                                width: '200px',
                                height: '150px',
                                backgroundColor: 'black',
                                opacity: 0.8
                            }}
                        />

                        {/* リアルタイム検出されたレシートのガイド枠 */}
                        {(() => {
                            // detectedCornersRefも確認（状態更新の遅延を考慮）
                            const corners = detectedCorners || detectedCornersRef.current;
                            const shouldShow = corners && corners.length === 4 && videoRef.current;
                            // デバッグログ（10%の確率で出力）
                            if (Math.random() < 0.1) {
                                // paramsやsearchParamsが含まれないように、明示的に値を抽出
                                const logData = {
                                    detectedCorners: detectedCorners ? detectedCorners.length : null,
                                    detectedCornersRef: detectedCornersRef.current ? detectedCornersRef.current.length : null,
                                    videoRef: !!videoRef.current,
                                    shouldShow: !!shouldShow
                                };
                                console.log('[UI] SVG render check:', logData);
                            }
                            return shouldShow;
                        })() && (
                                <svg
                                    className="absolute inset-0 pointer-events-none z-20"
                                    style={{ width: '100%', height: '100%' }}
                                >
                                    {(() => {
                                        const video = videoRef.current!;
                                        const videoRect = video.getBoundingClientRect();
                                        const videoWidth = video.videoWidth;
                                        const videoHeight = video.videoHeight;

                                        if (videoWidth === 0 || videoHeight === 0) return null;

                                        // detectedCornersRefも確認（状態更新の遅延を考慮）
                                        const corners = detectedCorners || detectedCornersRef.current;
                                        if (!corners || corners.length !== 4) return null;

                                        // object-fit: coverの場合のスケール計算
                                        const videoAspect = videoWidth / videoHeight;
                                        const displayAspect = videoRect.width / videoRect.height;

                                        let scaleX: number, scaleY: number;
                                        let offsetX = 0, offsetY = 0;

                                        if (videoAspect > displayAspect) {
                                            // ビデオが横長の場合、高さに合わせてスケール
                                            scaleY = videoRect.height / videoHeight;
                                            scaleX = scaleY;
                                            offsetX = (videoRect.width - videoWidth * scaleX) / 2;
                                        } else {
                                            // ビデオが縦長の場合、幅に合わせてスケール
                                            scaleX = videoRect.width / videoWidth;
                                            scaleY = scaleX;
                                            offsetY = (videoRect.height - videoHeight * scaleY) / 2;
                                        }

                                        // 検出された座標（正規化0-1）を画面座標に変換
                                        const screenCorners = corners.map(corner => ({
                                            x: corner.x * videoWidth * scaleX + offsetX,
                                            y: corner.y * videoHeight * scaleY + offsetY
                                        }));

                                        // 20%パディングを追加した範囲を計算（レシート全体が確実に残るように）
                                        const minX = Math.min(...screenCorners.map(c => c.x));
                                        const maxX = Math.max(...screenCorners.map(c => c.x));
                                        const minY = Math.min(...screenCorners.map(c => c.y));
                                        const maxY = Math.max(...screenCorners.map(c => c.y));
                                        const width = maxX - minX;
                                        const height = maxY - minY;
                                        const paddingX = width * 0.1; // 10%のパディング（上下左右にそれぞれ10%ずつ）
                                        const paddingY = height * 0.1; // 10%のパディング（上下左右にそれぞれ10%ずつ）

                                        const paddedCorners = [
                                            { x: Math.max(0, minX - paddingX), y: Math.max(0, minY - paddingY) }, // 左上
                                            { x: Math.min(videoRect.width, maxX + paddingX), y: Math.max(0, minY - paddingY) }, // 右上
                                            { x: Math.min(videoRect.width, maxX + paddingX), y: Math.min(videoRect.height, maxY + paddingY) }, // 右下
                                            { x: Math.max(0, minX - paddingX), y: Math.min(videoRect.height, maxY + paddingY) }  // 左下
                                        ];

                                        const pathData = `M ${paddedCorners[0].x} ${paddedCorners[0].y} L ${paddedCorners[1].x} ${paddedCorners[1].y} L ${paddedCorners[2].x} ${paddedCorners[2].y} L ${paddedCorners[3].x} ${paddedCorners[3].y} Z`;

                                        return (
                                            <>
                                                {/* マスクパス（レシートの外側を暗くする） */}
                                                <defs>
                                                    <mask id="receipt-mask">
                                                        <rect width="100%" height="100%" fill="white" />
                                                        <path d={pathData} fill="black" />
                                                    </mask>
                                                </defs>
                                                <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#receipt-mask)" />

                                                {/* レシートの境界線（20%パディング付き） */}
                                                <path
                                                    d={pathData}
                                                    fill="none"
                                                    stroke="rgba(37, 99, 235, 1)"
                                                    strokeWidth="3"
                                                    strokeDasharray="8 4"
                                                    strokeLinecap="round"
                                                />

                                                {/* 四隅のマーカー */}
                                                {paddedCorners.map((corner, index) => (
                                                    <g key={index}>
                                                        <circle
                                                            cx={corner.x}
                                                            cy={corner.y}
                                                            r="8"
                                                            fill="rgba(37, 99, 235, 0.9)"
                                                            stroke="rgba(37, 99, 235, 1)"
                                                            strokeWidth="2"
                                                        />
                                                        {/* L字型マーカー */}
                                                        {index === 0 && ( // 左上
                                                            <>
                                                                <line x1={corner.x} y1={corner.y} x2={corner.x + 20} y2={corner.y} stroke="rgba(37, 99, 235, 1)" strokeWidth="2" />
                                                                <line x1={corner.x} y1={corner.y} x2={corner.x} y2={corner.y + 20} stroke="rgba(37, 99, 235, 1)" strokeWidth="2" />
                                                            </>
                                                        )}
                                                        {index === 1 && ( // 右上
                                                            <>
                                                                <line x1={corner.x} y1={corner.y} x2={corner.x - 20} y2={corner.y} stroke="rgba(37, 99, 235, 1)" strokeWidth="2" />
                                                                <line x1={corner.x} y1={corner.y} x2={corner.x} y2={corner.y + 20} stroke="rgba(37, 99, 235, 1)" strokeWidth="2" />
                                                            </>
                                                        )}
                                                        {index === 2 && ( // 右下
                                                            <>
                                                                <line x1={corner.x} y1={corner.y} x2={corner.x - 20} y2={corner.y} stroke="rgba(37, 99, 235, 1)" strokeWidth="2" />
                                                                <line x1={corner.x} y1={corner.y} x2={corner.x} y2={corner.y - 20} stroke="rgba(37, 99, 235, 1)" strokeWidth="2" />
                                                            </>
                                                        )}
                                                        {index === 3 && ( // 左下
                                                            <>
                                                                <line x1={corner.x} y1={corner.y} x2={corner.x + 20} y2={corner.y} stroke="rgba(37, 99, 235, 1)" strokeWidth="2" />
                                                                <line x1={corner.x} y1={corner.y} x2={corner.x} y2={corner.y - 20} stroke="rgba(37, 99, 235, 1)" strokeWidth="2" />
                                                            </>
                                                        )}
                                                    </g>
                                                ))}
                                            </>
                                        );
                                    })()}
                                </svg>
                            )}

                        {/* 水平ガイド線（検出されたレシートがある場合も表示） */}
                        {(() => {
                            const corners = detectedCorners || detectedCornersRef.current;
                            return corners && corners.length === 4;
                        })() && (
                                <div className="absolute left-0 right-0 top-1/2 transform -translate-y-1/2 pointer-events-none z-25">
                                    <div className="border-t-2 border-dashed border-blue-500"></div>
                                </div>
                            )}

                        {/* デフォルトガイド（レシートが検知できない場合） */}
                        {(() => {
                            // detectedCornersRefも確認（状態更新の遅延を考慮）
                            const corners = detectedCorners || detectedCornersRef.current;
                            return !corners || corners.length !== 4;
                        })() && (
                                <div className="absolute inset-0 pointer-events-none">
                                    {/* レスポンシブな正方形のサイズ: レシートが切れないように少し小さめに設定 */}
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="relative" style={{
                                            width: isMobileDevice()
                                                ? 'min(85vw, 85vh)'  // スマホ: 画面の約85%（レシートが切れないように余裕を持たせる）
                                                : 'min(70vw, 70vh)', // PC: 70%（レシートが切れないように余裕を持たせる）
                                            height: isMobileDevice()
                                                ? 'min(85vw, 85vh)'
                                                : 'min(70vw, 70vh)',
                                            aspectRatio: '1 / 1'
                                        }}>
                                            {/* レシート用ガイド枠の境界線（点線の矩形） */}
                                            <div className="absolute inset-0 border-2 border-dashed border-blue-500 rounded-lg shadow-lg"></div>

                                            {/* L字型のフォーカス・マーカー（四隅） */}
                                            {/* 左上 */}
                                            <div className="absolute top-0 left-0 w-12 h-12">
                                                <div className="absolute top-0 left-0 w-6 h-1 bg-blue-500 rounded-full shadow-lg"></div>
                                                <div className="absolute top-0 left-0 w-1 h-6 bg-blue-500 rounded-full shadow-lg"></div>
                                            </div>
                                            {/* 右上 */}
                                            <div className="absolute top-0 right-0 w-12 h-12">
                                                <div className="absolute top-0 right-0 w-6 h-1 bg-blue-500 rounded-full shadow-lg"></div>
                                                <div className="absolute top-0 right-0 w-1 h-6 bg-blue-500 rounded-full shadow-lg"></div>
                                            </div>
                                            {/* 右下 */}
                                            <div className="absolute bottom-0 right-0 w-12 h-12">
                                                <div className="absolute bottom-0 right-0 w-6 h-1 bg-blue-500 rounded-full shadow-lg"></div>
                                                <div className="absolute bottom-0 right-0 w-1 h-6 bg-blue-500 rounded-full shadow-lg"></div>
                                            </div>
                                            {/* 左下 */}
                                            <div className="absolute bottom-0 left-0 w-12 h-12">
                                                <div className="absolute bottom-0 left-0 w-6 h-1 bg-blue-500 rounded-full shadow-lg"></div>
                                                <div className="absolute bottom-0 left-0 w-1 h-6 bg-blue-500 rounded-full shadow-lg"></div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* オーバーレイ（半透明の黒） - レスポンシブ対応、枠外を暗くする */}
                                    {(() => {
                                        const isMobile = isMobileDevice();
                                        const guideSizePercent = isMobile ? 0.85 : 0.70; // スマホは約85%、PCは70%（レシートが切れないように余裕を持たせる）
                                        const halfGuideSize = `min(${guideSizePercent * 50}vw, ${guideSizePercent * 50}vh)`;

                                        return (
                                            <>
                                                {/* 上部のオーバーレイ */}
                                                <div
                                                    className="absolute top-0 left-0 right-0 bg-black/60"
                                                    style={{ height: `calc(50% - ${halfGuideSize})` }}
                                                ></div>
                                                {/* 下部のオーバーレイ */}
                                                <div
                                                    className="absolute bottom-0 left-0 right-0 bg-black/60"
                                                    style={{ height: `calc(50% - ${halfGuideSize})` }}
                                                ></div>
                                                {/* 左側のオーバーレイ */}
                                                <div
                                                    className="absolute bg-black/60"
                                                    style={{
                                                        top: `calc(50% - ${halfGuideSize})`,
                                                        bottom: `calc(50% - ${halfGuideSize})`,
                                                        left: 0,
                                                        width: `calc(50% - ${halfGuideSize})`
                                                    }}
                                                ></div>
                                                {/* 右側のオーバーレイ */}
                                                <div
                                                    className="absolute bg-black/60"
                                                    style={{
                                                        top: `calc(50% - ${halfGuideSize})`,
                                                        bottom: `calc(50% - ${halfGuideSize})`,
                                                        right: 0,
                                                        width: `calc(50% - ${halfGuideSize})`
                                                    }}
                                                ></div>
                                            </>
                                        );
                                    })()}

                                    {/* ガイドメッセージ */}
                                    <div className="absolute top-8 left-0 right-0 text-center pointer-events-none z-30">
                                        <div className="inline-block bg-black/70 px-4 py-2 rounded-lg backdrop-blur-sm">
                                            <p className="text-white text-sm font-medium drop-shadow-lg">
                                                {(() => {
                                                    // detectedCornersRefも確認（状態更新の遅延を考慮）
                                                    const corners = detectedCorners || detectedCornersRef.current;
                                                    const hasDetectedCorners = corners && corners.length === 4;
                                                    return hasDetectedCorners
                                                        ? '✅ レシートを検知しました。撮影ボタンを押してください。'
                                                        : '📷 レシートを枠内に合わせてください';
                                                })()}
                                            </p>
                                            {/* デバッグ情報（開発環境のみ） */}
                                            {process.env.NODE_ENV === 'development' && (
                                                <p className="text-xs text-gray-500 mt-1">
                                                    {(() => {
                                                        const corners = detectedCorners || detectedCornersRef.current;
                                                        return corners ? `検出中: ${corners.length}点` : '検出なし';
                                                    })()}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {/* 水平ガイドメッセージ（常に表示） */}
                                    <div className="absolute top-20 left-0 right-0 text-center pointer-events-none z-30">
                                        <div className="inline-block bg-black/60 px-4 py-2 rounded-lg backdrop-blur-sm">
                                            <p className="text-white text-xs font-medium drop-shadow-lg">
                                                金額が左から右へ水平になるように撮影してください
                                            </p>
                                        </div>
                                    </div>

                                    {/* 水平ガイド線（画面中央） */}
                                    <div className="absolute left-0 right-0 top-1/2 transform -translate-y-1/2 pointer-events-none z-20">
                                        <div className="border-t-2 border-dashed border-blue-500"></div>
                                    </div>
                                </div>
                            )}

                        <button
                            onClick={stopCamera}
                            className="absolute top-4 right-4 p-2 bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors z-30"
                        >
                            <X size={24} />
                        </button>
                    </div>

                    {/* 撮影ボタン（モバイル最適化：画面下部中央、親指で押しやすい大きさ） */}
                    <div className="bg-black pb-8 pt-4 flex flex-col justify-center items-center flex-shrink-0 relative z-20 safe-area-inset-bottom">
                        {/* バリデーション警告 */}
                        {(() => {
                            // detectedCornersRefも確認（状態更新の遅延を考慮）
                            const corners = detectedCorners || detectedCornersRef.current;
                            return corners && !isReceiptAreaValid;
                        })() && (
                                <div className="mb-2 px-4 py-2 bg-gray-700 text-white text-sm rounded-lg">
                                    レシートが小さすぎます。もう少し近づけてください。
                                </div>
                            )}

                        {/* 横倒し警告 */}
                        {(() => {
                            // detectedCornersRefも確認（状態更新の遅延を考慮）
                            const corners = detectedCorners || detectedCornersRef.current;
                            return corners && corners.length === 4 && isReceiptLandscape;
                        })() && (
                                <div className="mb-2 px-4 py-2 bg-yellow-600/90 text-white text-sm rounded-lg font-medium animate-pulse">
                                    ⚠️ レシートを縦（または文字を水平）にしてください
                                </div>
                            )}
                        <button
                            onClick={capturePhoto}
                            disabled={(() => {
                                // detectedCornersRefも確認（状態更新の遅延を考慮）
                                const corners = detectedCorners || detectedCornersRef.current;
                                return corners !== null && !isReceiptAreaValid;
                            })()}
                            className={`w-24 h-24 rounded-full border-4 transition-all shadow-2xl active:scale-90 z-20 flex items-center justify-center ${(() => {
                                const corners = detectedCorners || detectedCornersRef.current;
                                return corners !== null && !isReceiptAreaValid;
                            })()
                                ? 'bg-gray-500 border-gray-700 cursor-not-allowed opacity-50'
                                : 'bg-white border-gray-300 hover:border-gray-500 hover:bg-gray-100'
                                }`}
                            aria-label="写真を撮る"
                            type="button"
                        >
                            <div className={`w-20 h-20 rounded-full border-2 ${(() => {
                                const corners = detectedCorners || detectedCornersRef.current;
                                return corners !== null && !isReceiptAreaValid;
                            })()
                                ? 'bg-gray-500 border-gray-700'
                                : 'bg-white border-gray-300'
                                }`}></div>
                        </button>
                    </div>
                </div>
            )}

            {/* プレビュー画面 */}
            {previewImage && !isCameraActive && (
                <div className="fixed inset-0 z-50 bg-black flex flex-col">
                    {/* 自動解析中のメッセージ */}
                    {isOcrProcessing && (
                        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-60 bg-blue-600 text-white px-6 py-3 rounded-lg backdrop-blur-sm shadow-lg">
                            <div className="flex items-center gap-3">
                                <Loader2 className="animate-spin" size={20} />
                                <span className="font-medium">解析中...</span>
                            </div>
                        </div>
                    )}
                    <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
                        {previewImageUrlRef.current ? (
                            <img
                                src={previewImageUrlRef.current}
                                alt="Preview"
                                className="max-w-full max-h-full object-contain"
                            />
                        ) : (
                            <div className="text-white text-center">
                                <Loader2 className="animate-spin mx-auto mb-2" size={32} />
                                <p>画像を読み込んでいます...</p>
                            </div>
                        )}
                    </div>
                    <div className="bg-black pb-8 pt-4 px-4 flex gap-3">
                        <button
                            onClick={() => {
                                setPreviewImage(null);
                                startCamera();
                            }}
                            className="flex-1 px-6 py-3 border-2 border-gray-300 rounded-lg text-white hover:bg-gray-700 transition-colors font-medium"
                        >
                            撮り直す
                        </button>
                        <button
                            onClick={startOcrAnalysis}
                            disabled={isOcrProcessing}
                            className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isOcrProcessing ? (
                                <span className="flex items-center justify-center gap-2">
                                    <Loader2 className="animate-spin" size={20} />
                                    解析中...
                                </span>
                            ) : (
                                '再解析'
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* Camera Button */}
            {!isCameraActive && !previewImage && (
                <div className="fixed bottom-6 right-6 z-40">
                    <button
                        onClick={startCamera}
                        className="w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-colors"
                        aria-label="カメラを開く"
                    >
                        <Camera size={24} />
                    </button>
                </div>
            )}

            {/* File Input (Hidden) */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileSelect}
                className="hidden"
            />

            {/* Canvas (Hidden) */}
            <canvas ref={canvasRef} className="hidden" />

            {/* OpenCV.js Script - 重複読み込みを防ぐため、一度だけ読み込む */}
            <Script
                src="https://docs.opencv.org/4.x/opencv.js"
                strategy="lazyOnload"
                id="opencv-js"
                onLoad={() => {
                    if (typeof window !== 'undefined' && window.cv) {
                        // 既に初期化済みの場合は即座にセット
                        if (window.cv.Mat) {
                            console.log('OpenCV.js already initialized');
                            setIsOpenCvReady(true);
                        } else {
                            // 初期化イベントを設定
                            window.cv.onRuntimeInitialized = () => {
                                console.log('OpenCV.js runtime initialized');
                                setIsOpenCvReady(true);
                            };
                        }
                    }
                }}
                onError={(e) => {
                    console.error('Failed to load OpenCV.js:', e);
                }}
            />

            {/* Receipt Grid */}
            <main className="max-w-4xl mx-auto px-4 py-6">
                {receipts.length === 0 ? (
                    <div className="text-center py-12">
                        <Camera className="mx-auto text-gray-500 mb-4" size={48} />
                        <p className="text-gray-500 text-lg">レシートがありません</p>
                        <p className="text-gray-500 text-sm mt-2">右下のカメラボタンから撮影してください</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* ソートコントロール */}
                        <div className="flex items-center justify-between bg-white rounded-lg shadow-sm p-4 sticky top-16 z-10 border border-gray-300">
                            <h2 className="text-lg font-semibold text-gray-900">レシート一覧</h2>
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                    <label className="text-sm text-gray-500">ソート基準:</label>
                                    <select
                                        value={sortBy}
                                        onChange={(e) => setSortBy(e.target.value as 'timestamp' | 'receiptDate')}
                                        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:border-transparent bg-white"
                                    >
                                        <option value="receiptDate">レシート日時</option>
                                        <option value="timestamp">撮影時間</option>
                                    </select>
                                </div>
                                <div className="flex items-center gap-2">
                                    <label className="text-sm text-gray-500">並び順:</label>
                                    <select
                                        value={sortOrder}
                                        onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest')}
                                        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-600 focus:border-transparent bg-white"
                                    >
                                        <option value="newest">新しい順</option>
                                        <option value="oldest">古い順</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* 月別グループ表示 */}
                        {groupedReceipts.sortedMonthKeys.map((monthKey) => {
                            const monthReceipts = groupedReceipts.grouped[monthKey];
                            const monthlyTotal = getMonthlyTotal(monthReceipts);

                            return (
                                <div key={monthKey} className="bg-white rounded-lg shadow-sm border border-gray-300 overflow-hidden mb-6">
                                    {/* 月間サマリーヘッダー */}
                                    <div className="bg-gray-100 border-b border-gray-300 px-6 py-4">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-xl font-bold text-gray-900">
                                                {formatMonthName(monthKey)}
                                            </h3>
                                            <div className="flex items-center gap-4">
                                                <span className="text-sm text-gray-500">合計:</span>
                                                {Object.entries(monthlyTotal).map(([currency, amount]) => (
                                                    <span key={currency} className="text-lg font-semibold text-blue-600">
                                                        {formatAmount(amount, currency)}
                                                    </span>
                                                ))}
                                                <span className="text-sm text-gray-500">
                                                    ({monthReceipts.length}件)
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* レシートグリッド */}
                                    <div className="p-4 pt-6">
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                                            {monthReceipts.map((receipt) => {
                                                if (!receipt.id) return null;

                                                let imageUrl = imageUrlsRef.current.get(receipt.id);
                                                if (!imageUrl) {
                                                    imageUrl = URL.createObjectURL(receipt.image);
                                                    imageUrlsRef.current.set(receipt.id, imageUrl);
                                                }

                                                return (
                                                    <div
                                                        key={receipt.id}
                                                        className="relative bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col"
                                                        style={{ aspectRatio: '3/4' }}
                                                    >
                                                        {/* レシート画像（統一サイズ） */}
                                                        <div className="relative flex-1 bg-gray-100 flex items-center justify-center overflow-hidden">
                                                            <img
                                                                src={imageUrl}
                                                                alt={`Receipt ${receipt.id}`}
                                                                className="w-full h-full object-contain cursor-pointer"
                                                                loading="lazy"
                                                                onClick={() => {
                                                                    // 画像をクリックしたときに拡大表示
                                                                    setExpandedImage({ url: imageUrl, receipt });
                                                                }}
                                                                onError={(e) => {
                                                                    console.error('Failed to load image:', receipt.id);
                                                                    e.currentTarget.style.display = 'none';
                                                                }}
                                                            />
                                                        </div>

                                                        {/* 情報とボタンエリア */}
                                                        <div className="bg-white p-3 border-t border-gray-300">
                                                            {/* 店名と金額 */}
                                                            <div className="mb-2">
                                                                <div className="font-semibold text-sm text-gray-900 mb-1 line-clamp-1">
                                                                    {receipt.vendor || '店名なし'}
                                                                </div>
                                                                <div className="font-bold text-base text-gray-900 flex items-center gap-1">
                                                                    {formatAmount(receipt.amount || 0, receipt.currency)}
                                                                    {receipt.currency && (
                                                                        <span className="text-xs font-normal text-gray-500">
                                                                            ({receipt.currency})
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            {/* 経費カテゴリ */}
                                                            {receipt.expenseCategory && (
                                                                <div className="mb-2">
                                                                    {getExpenseCategoryBadge(receipt.expenseCategory)}
                                                                </div>
                                                            )}

                                                            {/* 日付情報 */}
                                                            <div className="text-xs text-gray-500 mb-2 space-y-0.5">
                                                                <div>📸 {formatDate(receipt.timestamp)}</div>
                                                                {receipt.receiptDate && (
                                                                    <div>📅 {formatDate(receipt.receiptDate)}</div>
                                                                )}
                                                            </div>

                                                            {/* 編集・削除ボタン */}
                                                            <div className="flex items-center gap-2 pt-2 border-t border-gray-300">
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        openEditModal(receipt);
                                                                    }}
                                                                    className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors flex items-center justify-center gap-1"
                                                                    aria-label="編集"
                                                                    type="button"
                                                                >
                                                                    <Edit2 size={14} />
                                                                    <span>編集</span>
                                                                </button>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        if (receipt.id) {
                                                                            deleteReceipt(receipt.id);
                                                                        }
                                                                    }}
                                                                    className="flex-1 px-3 py-1.5 bg-red-600 hover:bg-blue-700 text-white text-xs rounded transition-colors flex items-center justify-center gap-1"
                                                                    aria-label="削除"
                                                                    type="button"
                                                                >
                                                                    <X size={14} />
                                                                    <span>削除</span>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {/* 日付不明のレシート */}
                        {groupedReceipts.unknownDateReceipts.length > 0 && (
                            <div className="bg-white rounded-lg shadow-sm border border-gray-300 overflow-hidden">
                                {/* 日付不明セクションヘッダー */}
                                <div className="bg-gray-100 border-b border-gray-300 px-6 py-4">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-xl font-bold text-gray-900">
                                            日付不明
                                        </h3>
                                        <div className="flex items-center gap-4">
                                            <span className="text-sm text-gray-500">合計:</span>
                                            {Object.entries(getMonthlyTotal(groupedReceipts.unknownDateReceipts)).map(([currency, amount]) => (
                                                <span key={currency} className="text-lg font-semibold text-gray-700">
                                                    {formatAmount(amount, currency)}
                                                </span>
                                            ))}
                                            <span className="text-sm text-gray-500">
                                                ({groupedReceipts.unknownDateReceipts.length}件)
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* レシートグリッド */}
                                <div className="p-4">
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                                        {groupedReceipts.unknownDateReceipts.map((receipt) => {
                                            if (!receipt.id) return null;

                                            let imageUrl = imageUrlsRef.current.get(receipt.id);
                                            if (!imageUrl) {
                                                imageUrl = URL.createObjectURL(receipt.image);
                                                imageUrlsRef.current.set(receipt.id, imageUrl);
                                            }

                                            return (
                                                <div
                                                    key={receipt.id}
                                                    className="relative bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col"
                                                    style={{ aspectRatio: '3/4' }}
                                                >
                                                    {/* レシート画像（統一サイズ） */}
                                                    <div className="relative flex-1 bg-gray-100 flex items-center justify-center overflow-hidden">
                                                        <img
                                                            src={imageUrl}
                                                            alt={`Receipt ${receipt.id}`}
                                                            className="w-full h-full object-contain cursor-pointer"
                                                            loading="lazy"
                                                            onClick={() => {
                                                                // 画像をクリックしたときに拡大表示
                                                                setExpandedImage({ url: imageUrl, receipt });
                                                            }}
                                                            onError={(e) => {
                                                                console.error('Failed to load image:', receipt.id);
                                                                e.currentTarget.style.display = 'none';
                                                            }}
                                                        />
                                                    </div>

                                                    {/* 情報とボタンエリア */}
                                                    <div className="bg-white p-3 border-t border-gray-300">
                                                        {/* 店名と金額 */}
                                                        <div className="mb-2">
                                                            <div className="font-semibold text-sm text-gray-900 mb-1 line-clamp-1">
                                                                {receipt.vendor || '店名なし'}
                                                            </div>
                                                            <div className="font-bold text-base text-gray-900 flex items-center gap-1">
                                                                {formatAmount(receipt.amount || 0, receipt.currency)}
                                                                {receipt.currency && (
                                                                    <span className="text-xs font-normal text-gray-500">
                                                                        ({receipt.currency})
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* 日付情報 */}
                                                        <div className="text-xs text-gray-500 mb-2 space-y-0.5">
                                                            <div>📸 {formatDate(receipt.timestamp)}</div>
                                                            {receipt.receiptDate && (
                                                                <div>📅 {formatDate(receipt.receiptDate)}</div>
                                                            )}
                                                        </div>

                                                        {/* 編集・削除ボタン */}
                                                        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    openEditModal(receipt);
                                                                }}
                                                                className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors flex items-center justify-center gap-1"
                                                                aria-label="編集"
                                                                type="button"
                                                            >
                                                                <Edit2 size={14} />
                                                                <span>編集</span>
                                                            </button>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (receipt.id) {
                                                                        deleteReceipt(receipt.id);
                                                                    }
                                                                }}
                                                                className="flex-1 px-3 py-1.5 bg-red-600 hover:bg-blue-700 text-white text-xs rounded transition-colors flex items-center justify-center gap-1"
                                                                aria-label="削除"
                                                                type="button"
                                                            >
                                                                <X size={14} />
                                                                <span>削除</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
