import Dexie, { Table } from 'dexie';

export interface Receipt {
    id?: number;
    image: Blob;
    timestamp: Date; // 撮影日時
    note: string;
    amount: number;
    vendor: string;
    currency?: string | null; // 通貨コード（JPY/THB）
    date?: string; // YYYY-MM-DD形式の日付（Geminiが読み取った日付）
    time?: string; // HH:MM形式の時刻（Geminiが読み取った時刻）
    receiptDate?: Date; // Geminiが読み取った日時をDateオブジェクトとして保存
    invoice_number?: string; // インボイス番号
    corners?: Array<{ x: number; y: number }>; // レシートの四隅の座標（0-1000の正規化座標）
}

export class MyDatabase extends Dexie {
    receipts!: Table<Receipt>;

    constructor() {
        super('ReceiptDatabase');
        this.version(1).stores({
            receipts: '++id, timestamp, vendor, amount' // 検索に使う項目を定義（amountもインデックスに追加）
        });
    }
}

// シングルトンパターン（接続を一つに保つ）
let db: MyDatabase | null = null;

export const getDb = (): MyDatabase | null => {
    // クライアントサイドでのみデータベースを初期化
    if (typeof window === 'undefined') {
        // SSR時はnullを返してエラーを回避
        return null;
    }

    if (!db) {
        db = new MyDatabase();
    }
    return db;
};