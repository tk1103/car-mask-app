import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        // 環境変数からAPIキーを取得（.env.localに記載されている正確な変数名を使用）
        // ガード節: APIキーが未設定の場合は詳細なエラーを返す
        const apiKey = process.env.GEMINI_API_KEY;

        // デバッグ用: 環境変数の状態をログに出力
        console.log('Environment check:', {
            hasApiKey: !!apiKey,
            apiKeyLength: apiKey?.length || 0,
            nodeEnv: process.env.NODE_ENV,
            allEnvKeys: Object.keys(process.env).filter(key => key.includes('GEMINI') || key.includes('GOOGLE') || key.includes('API'))
        });

        if (!apiKey || apiKey.trim() === '') {
            const availableEnvVars = Object.keys(process.env).filter(
                key => key.includes('GEMINI') || key.includes('GOOGLE') || key.includes('API')
            );
            console.error('ERROR: GEMINI_API_KEY is not set or empty in environment variables');
            console.error('Available related env vars:', availableEnvVars);
            console.error('NODE_ENV:', process.env.NODE_ENV);
            console.error('All env vars (first 20):', Object.keys(process.env).slice(0, 20));

            return NextResponse.json(
                {
                    error: 'API key is not configured',
                    message: 'GEMINI_API_KEY must be set in .env.local file',
                    userMessage: 'APIキーが設定されていません。.env.localファイルを確認してください。',
                    details: 'Please check your .env.local file and ensure GEMINI_API_KEY is set correctly. Available env vars: ' + availableEnvVars.join(', '),
                    troubleshooting: [
                        '1. プロジェクトルートに .env.local ファイルが存在するか確認',
                        '2. .env.local ファイルに GEMINI_API_KEY=your_api_key が記載されているか確認',
                        '3. 開発サーバーを再起動して環境変数を読み込む',
                        '4. .env.localファイルに余分なスペースや引用符がないか確認'
                    ]
                },
                { status: 500 }
            );
        }

        console.log('API key found, length:', apiKey.length, 'starts with:', apiKey.substring(0, 10) + '...');

        const formData = await request.formData();
        const imageFile = formData.get('image') as File | null;

        if (!imageFile) {
            console.error('ERROR: No image file provided in formData');
            console.error('FormData keys:', Array.from(formData.keys()));
            return NextResponse.json(
                {
                    error: 'No image file provided',
                    message: 'No image file provided',
                    userMessage: '画像ファイルが送信されませんでした。もう一度お試しください。',
                    details: 'FormData must contain an "image" field'
                },
                { status: 400 }
            );
        }

        console.log('Image file received:', {
            name: imageFile.name,
            type: imageFile.type,
            size: imageFile.size
        });

        // 画像をBase64に変換（Gemini 3 最新仕様に合わせた形式）
        const arrayBuffer = await imageFile.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Image = buffer.toString('base64');

        // MIMEタイプを確認・設定
        const mimeType = imageFile.type || 'image/jpeg';
        console.log('Image MIME type:', mimeType, 'Size:', buffer.length, 'bytes');

        // Gemini APIを初期化
        const genAI = new GoogleGenerativeAI(apiKey);

        // gemini-2.5-flashに完全固定（高速化のため）
        const modelName = 'gemini-2.5-flash';
        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "object" as const,
                    properties: {
                        vendor: { type: "string" as const },
                        amount: { type: "number" as const },
                        currency: { type: "string" as const },
                        date: { type: "string" as const },
                        time: { type: "string" as const },
                        invoice_number: { type: "string" as const },
                        corners: {
                            type: "array" as const,
                            items: {
                                type: "object" as const,
                                properties: {
                                    x: { type: "number" as const },
                                    y: { type: "number" as const }
                                },
                                required: ["x", "y"]
                            },
                            minItems: 4,
                            maxItems: 4
                        }
                    },
                    required: ["vendor", "amount", "currency", "date", "time", "invoice_number", "corners"]
                } as any
            }
        });

        console.log(`Using model: ${modelName} with JSON schema`);

        // 高精度OCRプロンプト（商品化レベルの精度を目指す）
        const prompt = `You are an expert OCR system for receipt scanning. Extract receipt information with maximum accuracy. The image is already cropped to focus on the receipt.

ANALYSIS STEPS (execute in order):

Step 1: RECEIPT BOUNDARY DETECTION
- Carefully examine the entire image to find the physical edges of the receipt paper
- Identify the four corners: top-left, top-right, bottom-right, bottom-left
- Return normalized coordinates (0-1000) for each corner
- Even if the image is cropped, detect the actual receipt edges within the frame

Step 2: COUNTRY AND CURRENCY IDENTIFICATION (GLOBAL SUPPORT)
- Analyze ALL visual cues to identify the country and currency:
  * Language patterns: Thai (ก-ฮ), Japanese (漢字/ひらがな/カタカナ), Chinese (中文), Korean (한글), English, European languages, etc.
  * VAT/Tax labels: "VAT", "GST", "TAX", "消費税", "ภาษีมูลค่าเพิ่ม", "IVA", "TVA", "MwSt", etc.
  * Date format: DD/MM/YYYY (European), MM/DD/YYYY (US), YYYY/MM/DD (ISO/Asian), Buddhist calendar (Thai)
  * Phone number format: Country-specific patterns (e.g., +66 for Thailand, +81 for Japan, +1 for US)
  * Business address: Country names, postal codes, area codes
  * Currency symbols: $ (USD/CAD/AUD/etc), € (EUR), £ (GBP), ¥ (JPY/CNY), ฿ (THB), ₩ (KRW), ₹ (INR), etc.
- If no currency symbol is found, infer the currency based on:
  * Language detected in the receipt text
  * Business address or location indicators
  * VAT/Tax label format (country-specific)
  * Date format patterns
  * Phone number country codes
- Output the ISO 4217 currency code (e.g., USD, EUR, GBP, JPY, THB, CNY, KRW, SGD, AUD, CAD, INR, etc.)

Step 3: DATA EXTRACTION (CRITICAL - MAXIMUM ACCURACY REQUIRED)

A. VENDOR (Store Name):
   - Read the store/company name EXACTLY as printed
   - Preserve ALL characters: English, Thai (อักษรไทย), Japanese (日本語), numbers, symbols
   - Common patterns: "ARNO'S", "ARNO'S GROUP", company names with "Co.,Ltd.", branch names like "Emquartier"
   - If multiple lines, combine them logically (e.g., "ARNO'S GROUP" + "national Co.,Ltd.")
   - Do NOT translate, transliterate, or modify the original text
   - If text is partially visible, read what you can see clearly

B. AMOUNT (Total Amount):
   - Find the TOTAL amount on the receipt (usually labeled as "Total", "合計", "รวม", "TOTAL", "Amount", "Summe", "Total", "合計金額")
   - Extract the EXACT numeric value as printed
   - Remove ONLY currency symbols (฿, ¥, $, €, £, ₩, ₹, etc.) and thousand separators (commas, spaces, periods)
   - Preserve decimal points and precision
   - Examples: "฿1,063.61" → 1063.61, "¥1,200" → 1200, "$15.00" → 15.00, "€25.50" → 25.50, "£10.99" → 10.99
   - If multiple amounts exist, choose the LARGEST number that appears near "Total" or similar labels
   - Do NOT convert between currencies - use the value as printed
   - VALIDATION: Consider typical price ranges for different currencies to avoid misreading:
     * Small amounts (5-50): Likely USD/EUR/GBP/SGD/AUD/CAD/EUR (e.g., lunch $15.00, coffee €3.50)
     * Medium amounts (50-500): Could be USD/EUR/GBP or THB/SGD (e.g., dinner $45.00, meal ฿350)
     * Large amounts (500-5000): Likely JPY/KRW/CNY (e.g., lunch ¥1,500, dinner ₩25,000)
     * Very large amounts (5000+): Likely JPY/KRW/CNY/VND (e.g., ¥12,000, ₩50,000)
     * Use context clues (item descriptions, store type) to validate amount reasonableness

C. CURRENCY (CRITICAL - GLOBAL INFERENCE WITH ISO 4217 CODES):
   - PRIMARY INDICATORS (highest priority - currency symbols):
     * Detect visible currency symbols: $ (USD/CAD/AUD/NZD/etc), € (EUR), £ (GBP), ¥ (JPY/CNY), ฿ (THB), ₩ (KRW), ₹ (INR), etc.
     * Detect currency text: "USD", "EUR", "GBP", "JPY", "THB", "CNY", "KRW", "SGD", "AUD", "CAD", "INR", etc.
   
   - INFERENCE RULES (when currency symbol is NOT visible - analyze all visual cues):
     
     * LANGUAGE-BASED INFERENCE:
       - Thai characters (ก-ฮ) → "THB" (Thai Baht)
       - Japanese characters (漢字/ひらがな/カタカナ) → "JPY" (Japanese Yen)
       - Chinese characters (中文) → "CNY" (Chinese Yuan) or "TWD" (Taiwan Dollar) based on context
       - Korean characters (한글) → "KRW" (Korean Won)
       - English + European context → "EUR" (Euro), "GBP" (British Pound), "USD" (US Dollar)
       - English + Asian context → "SGD" (Singapore Dollar), "MYR" (Malaysian Ringgit), "PHP" (Philippine Peso)
       - English + Oceania context → "AUD" (Australian Dollar), "NZD" (New Zealand Dollar)
       - English + Americas context → "USD" (US Dollar), "CAD" (Canadian Dollar), "MXN" (Mexican Peso)
     
     * VAT/TAX LABEL-BASED INFERENCE:
       - "VAT" (Value Added Tax) → European countries: "EUR", "GBP", etc.
       - "GST" (Goods and Services Tax) → "SGD" (Singapore), "AUD" (Australia), "CAD" (Canada), "NZD" (New Zealand)
       - "消費税" (Japanese consumption tax) → "JPY"
       - "ภาษีมูลค่าเพิ่ม" (Thai VAT) → "THB"
       - "IVA" (Impuesto sobre el Valor Añadido) → "EUR" (Spain), "MXN" (Mexico), etc.
       - "TVA" (Taxe sur la Valeur Ajoutée) → "EUR" (France, Belgium, etc.)
       - "MwSt" (Mehrwertsteuer) → "EUR" (Germany, Austria)
     
     * DATE FORMAT-BASED INFERENCE:
       - DD/MM/YYYY → European countries ("EUR", "GBP"), Asian countries ("THB", "SGD")
       - MM/DD/YYYY → "USD" (US), "CAD" (Canada)
       - YYYY/MM/DD → "JPY" (Japan), "CNY" (China), "KRW" (Korea)
       - Buddhist calendar (2560-2570) → "THB" (Thailand)
     
     * PHONE NUMBER-BASED INFERENCE:
       - +66 → "THB" (Thailand)
       - +81 → "JPY" (Japan)
       - +86 → "CNY" (China)
       - +82 → "KRW" (Korea)
       - +65 → "SGD" (Singapore)
       - +1 → "USD" (US), "CAD" (Canada)
       - +44 → "GBP" (UK)
       - +49 → "EUR" (Germany)
       - +33 → "EUR" (France)
       - +61 → "AUD" (Australia)
     
     * AMOUNT RANGE-BASED INFERENCE (consider typical price ranges):
       - Small amounts (5-50): Likely "USD", "EUR", "GBP", "SGD", "AUD", "CAD" (e.g., lunch $15.00, coffee €3.50)
       - Medium amounts (50-500): Could be "USD"/"EUR"/"GBP" or "THB"/"SGD" (e.g., dinner $45.00, meal ฿350)
       - Large amounts (500-5000): Likely "JPY", "KRW", "CNY" (e.g., lunch ¥1,500, dinner ₩25,000)
       - Very large amounts (5000+): Likely "JPY", "KRW", "CNY", "VND" (e.g., ¥12,000, ₩50,000)
       - Use context clues (item descriptions, store type) to validate amount reasonableness
     
     * BUSINESS ADDRESS-BASED INFERENCE:
       - Country names, city names, postal codes, area codes can indicate currency
       - Example: "Bangkok" → "THB", "Tokyo" → "JPY", "Singapore" → "SGD", "New York" → "USD"
     
     * DEFAULT: If uncertain and no clear indicators, return "USD" as default (most common)
   
   - OUTPUT: ISO 4217 currency code (3-letter uppercase: USD, EUR, GBP, JPY, THB, CNY, KRW, SGD, AUD, CAD, INR, etc.)
   - If multiple currencies are possible, choose the most likely based on strongest indicator

D. DATE:
   - Find the transaction date printed on the receipt
   - Format: YYYY/MM/DD (e.g., 2024/12/25)
   - If Thai calendar (Buddhist year 2560-2570 range), convert: Buddhist year - 543 = Gregorian year
   - Example: 2568/12/25 → 2025/12/25
   - If date format is different, convert to YYYY/MM/DD format
   - Use context clues (day names, month names) to verify accuracy

E. TIME:
   - Find the transaction time printed on the receipt
   - Format: HH:mm (24-hour format, e.g., 14:30, 18:45)
   - If 12-hour format with AM/PM, convert to 24-hour

F. INVOICE_NUMBER:
   - Look for invoice/receipt numbers
   - Thai receipts: Often "T" followed by 13 digits (T1234567890123)
   - Japanese receipts: Various formats
   - If not found or unclear, return null

G. CORNERS:
   - Return array of 4 coordinates: [{x, y}, {x, y}, {x, y}, {x, y}]
   - Order: top-left, top-right, bottom-right, bottom-left
   - Normalized coordinates (0-1000 range)
   - These should mark the physical edges of the receipt paper

QUALITY REQUIREMENTS:
- Read every character carefully, especially numbers
- Double-check amounts by verifying against itemized lists if visible
- Verify date consistency (e.g., day of week matches date)
- If text is blurry or unclear, make your best interpretation but flag uncertainty
- For vendor names, prioritize accuracy over completeness (better to have partial accurate name than full incorrect name)

RETURN:
- Return the actual printed date/time, NOT the current date/time
- All extracted values must match what is VISIBLY PRINTED on the receipt
- If you cannot determine a value with confidence, use null or empty string appropriately`;

        // 画像とプロンプトを送信（gemini-2.5-flashに固定、フォールバックなし）
        const imagePart = {
            inlineData: {
                data: base64Image,
                mimeType: mimeType,
            },
        };

        let result;
        let response;
        try {
            result = await model.generateContent([prompt, imagePart]);
            response = await result.response;
        } catch (apiError: any) {
            // Gemini APIからのエラーを詳細に処理
            console.error('=== Gemini API call failed ===');
            console.error('Error object:', apiError);
            console.error('Error type:', typeof apiError);
            console.error('Error constructor:', apiError?.constructor?.name);
            console.error('Error message:', apiError?.message);
            console.error('Error status:', apiError?.status);
            console.error('Error response:', apiError?.response);
            console.error('Error stack:', apiError?.stack);
            console.error('Full error:', JSON.stringify(apiError, Object.getOwnPropertyNames(apiError), 2));

            const errorMessage = apiError?.message || String(apiError);
            const errorStatus = apiError?.status || apiError?.response?.status || apiError?.response?.statusCode;

            // 503エラー（サービス利用不可・過負荷）を検出
            if (errorStatus === 503 || errorMessage.toLowerCase().includes('503') ||
                errorMessage.toLowerCase().includes('overloaded') ||
                errorMessage.toLowerCase().includes('service unavailable')) {
                return NextResponse.json({
                    error: 'Service unavailable',
                    message: 'モデルが過負荷のため利用できません',
                    userMessage: 'モデルが過負荷のため、しばらく待ってから再度お試しください。',
                    details: 'Gemini APIのモデルが一時的に過負荷状態です。数秒から数分待ってから再度お試しください。',
                    type: 'ServiceUnavailableError',
                    status: 503
                }, { status: 503 });
            }

            // 429エラー（レート制限・クォータ制限）を検出
            if (errorStatus === 429 || errorMessage.toLowerCase().includes('429') ||
                errorMessage.toLowerCase().includes('quota') ||
                errorMessage.toLowerCase().includes('rate limit')) {
                // リトライ推奨時間を抽出（RetryInfoから）
                let retryAfter = null;
                try {
                    const retryInfoMatch = errorMessage.match(/Please retry in ([\d.]+)s/i);
                    if (retryInfoMatch) {
                        retryAfter = Math.ceil(parseFloat(retryInfoMatch[1]));
                    }
                } catch (e) {
                    // リトライ時間の抽出に失敗した場合は無視
                }

                // クォータ制限の詳細を抽出
                const quotaMatch = errorMessage.match(/limit: (\d+), model: ([^\s]+)/);
                const quotaLimit = quotaMatch ? quotaMatch[1] : null;
                const quotaModel = quotaMatch ? quotaMatch[2] : null;

                return NextResponse.json({
                    error: 'Quota exceeded',
                    message: 'APIの利用制限に達しました',
                    userMessage: `無料プランの1日あたりのリクエスト制限（${quotaLimit || 20}回）に達しました。${retryAfter ? `約${retryAfter}秒後` : '明日'}に再度お試しください。`,
                    details: `無料プランでは1日あたり${quotaLimit || 20}リクエストまで利用できます。制限に達した場合は、翌日までお待ちいただくか、有料プランへのアップグレードをご検討ください。`,
                    type: 'QuotaExceededError',
                    status: 429,
                    retryAfter: retryAfter,
                    quotaLimit: quotaLimit,
                    quotaModel: quotaModel
                }, {
                    status: 429,
                    headers: retryAfter ? {
                        'Retry-After': retryAfter.toString()
                    } : {}
                });
            }

            // APIキー関連のエラーを検出
            if (errorStatus === 401 || errorStatus === 403 ||
                errorMessage.toLowerCase().includes('api key') ||
                errorMessage.toLowerCase().includes('authentication') ||
                errorMessage.toLowerCase().includes('unauthorized')) {
                return NextResponse.json({
                    error: 'Authentication failed',
                    message: 'APIキーの認証に失敗しました',
                    userMessage: 'APIキーの設定を確認してください。',
                    details: '.env.localファイルにGEMINI_API_KEYが正しく設定されているか確認してください。開発サーバーを再起動してください。',
                    type: 'AuthenticationError',
                    status: 401
                }, { status: 401 });
            }

            // その他のエラー
            throw apiError;
        }

        // JSONスキーマを使用しているため、直接JSONとして取得
        let text: string;
        try {
            text = await response.text();
            console.log('Response text length:', text?.length || 0);
            console.log('Response text preview:', text?.substring(0, 200) || 'Empty');
        } catch (textError: any) {
            console.error('Failed to get response text:', textError);
            throw new Error(`Failed to get response text: ${textError?.message || String(textError)}`);
        }

        // JSONスキーマを使用しているため、パース処理を簡略化
        let jsonText = text.trim();
        console.log('JSON text to parse (first 500 chars):', jsonText.substring(0, 500));

        // JSONをパース（JSONスキーマを使用しているため、直接パース可能）
        let parsedData;
        try {
            parsedData = JSON.parse(jsonText);
            console.log('Successfully parsed JSON:', Object.keys(parsedData));
            console.log('Parsed data preview:', JSON.stringify(parsedData, null, 2).substring(0, 500));
        } catch (parseError: any) {
            console.error('=== JSON Parse Error ===');
            console.error('Parse error:', parseError);
            console.error('Parse error message:', parseError?.message);
            console.error('Response text length:', text.length);
            console.error('Response text (first 1000 chars):', text.substring(0, 1000));
            console.error('Response text (last 500 chars):', text.substring(Math.max(0, text.length - 500)));
            throw new Error(`Failed to parse JSON response from Gemini API: ${parseError?.message || String(parseError)}`);
        }

        // 金額のクリーニング（￥、¥、฿、カンマ、スペースを除去）
        if (typeof parsedData.amount === 'string') {
            // より厳密なクリーニング（スペースも除去）
            parsedData.amount = parseFloat(parsedData.amount.replace(/[￥¥฿,\s]/g, '')) || 0;
        }

        // 金額の検証（0より大きい値であることを確認）
        if (parsedData.amount <= 0) {
            console.warn('Amount is 0 or negative, this might indicate an extraction error');
        }

        // 店名の検証とクリーニング
        if (parsedData.vendor) {
            // 前後の空白を削除
            parsedData.vendor = parsedData.vendor.trim();
            // 複数の空白を1つに
            parsedData.vendor = parsedData.vendor.replace(/\s+/g, ' ');
        }

        // cornersの検証（4つの座標があるか確認）
        let corners = parsedData.corners;
        if (corners && Array.isArray(corners) && corners.length === 4) {
            // 各座標が正しい形式か確認
            const validCorners = corners.every((c: any) =>
                c && typeof c.x === 'number' && typeof c.y === 'number' &&
                c.x >= 0 && c.x <= 1000 && c.y >= 0 && c.y <= 1000
            );
            if (!validCorners) {
                console.warn('Invalid corners format, setting to undefined');
                corners = undefined;
            }
        } else {
            corners = undefined;
        }

        // 通貨の自動判別とタイ暦の変換（全世界対応の高精度判定ロジック）
        let currency = parsedData.currency || null;
        let amount = parsedData.amount || 0;
        let inferenceReason = '';

        // 通貨コードを大文字に正規化（ISO 4217形式）
        if (currency) {
            currency = currency.toUpperCase().trim();
            // 主要なISO 4217通貨コードのリスト（一般的なもの）
            const validCurrencyCodes = [
                'USD', 'EUR', 'GBP', 'JPY', 'THB', 'CNY', 'KRW', 'SGD', 'AUD', 'CAD',
                'INR', 'HKD', 'NZD', 'MXN', 'PHP', 'MYR', 'IDR', 'VND', 'TWD', 'BRL',
                'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RUB', 'ZAR', 'TRY'
            ];
            // AIが返した通貨コードが有効かチェック（無効な場合はnullにして後で推論）
            if (!validCurrencyCodes.includes(currency)) {
                console.warn(`Invalid currency code from AI: ${currency}, will infer from context`);
                currency = null;
            }
        }

        // 通貨が判別されていない場合、補完的な推論ロジックを適用（AIが推論するので、サーバーサイドは補完的）
        if (!currency && text) {
            const lowerText = text.toLowerCase();

            // 通貨記号の検出（優先度最高）
            if (text.includes('$') && !text.includes('US$') && !text.includes('CA$') && !text.includes('AU$')) {
                // $記号は複数の通貨で使用されるため、コンテキストから判断
                if (text.includes('+1') || text.match(/\b\d{3}-\d{3}-\d{4}\b/)) {
                    currency = 'USD';
                    inferenceReason = 'usd_symbol_with_us_context';
                } else {
                    currency = 'USD'; // デフォルト
                    inferenceReason = 'dollar_symbol_detected';
                }
            } else if (text.includes('€') || text.includes('EUR')) {
                currency = 'EUR';
                inferenceReason = 'euro_symbol_detected';
            } else if (text.includes('£') || text.includes('GBP')) {
                currency = 'GBP';
                inferenceReason = 'pound_symbol_detected';
            } else if (text.includes('฿') || text.includes('บาท') || lowerText.includes('thb')) {
                currency = 'THB';
                inferenceReason = 'baht_symbol_detected';
            } else if (text.includes('¥') || text.includes('円') || lowerText.includes('jpy')) {
                currency = 'JPY';
                inferenceReason = 'yen_symbol_detected';
            } else if (text.includes('₩') || lowerText.includes('krw')) {
                currency = 'KRW';
                inferenceReason = 'won_symbol_detected';
            } else if (text.includes('₹') || lowerText.includes('inr')) {
                currency = 'INR';
                inferenceReason = 'rupee_symbol_detected';
            } else {
                // 言語ベースの推論
                const thaiCharPattern = /[ก-ฮ]/;
                const japaneseCharPattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
                const koreanCharPattern = /[가-힣]/;
                const chineseCharPattern = /[\u4E00-\u9FFF]/;

                if (thaiCharPattern.test(text)) {
                    currency = 'THB';
                    inferenceReason = 'thai_characters_detected';
                } else if (japaneseCharPattern.test(text)) {
                    currency = 'JPY';
                    inferenceReason = 'japanese_characters_detected';
                } else if (koreanCharPattern.test(text)) {
                    currency = 'KRW';
                    inferenceReason = 'korean_characters_detected';
                } else if (chineseCharPattern.test(text)) {
                    currency = 'CNY';
                    inferenceReason = 'chinese_characters_detected';
                } else if (amount >= 5.0 && amount <= 50.0) {
                    // 小額（ランチ代など）→ USD/EUR/GBP/SGD/AUD/CADの可能性
                    currency = 'USD';
                    inferenceReason = 'amount_range_5_50_usd_likely';
                } else if (amount >= 50.0 && amount <= 500.0) {
                    // 中額 → USD/EUR/GBP/THB/SGDの可能性
                    currency = 'USD';
                    inferenceReason = 'amount_range_50_500_usd_likely';
                } else if (amount >= 500 && amount <= 5000) {
                    // 高額 → JPY/KRW/CNYの可能性
                    currency = 'JPY';
                    inferenceReason = 'amount_range_500_5000_jpy_likely';
                } else if (amount >= 5000) {
                    // 超高額 → JPY/KRW/CNY/VNDの可能性
                    currency = 'JPY';
                    inferenceReason = 'amount_range_5000_plus_jpy_likely';
                } else {
                    // デフォルト
                    currency = 'USD';
                    inferenceReason = 'default_usd_no_indicators';
                }
            }

            console.log(`Currency inference (server-side): ${currency}, reason: ${inferenceReason}, amount: ${amount}`);
        } else if (currency) {
            // 通貨が既に判定されている場合でも、推論理由を記録
            if (text.includes('$')) {
                inferenceReason = 'dollar_symbol_in_response';
            } else if (text.includes('€')) {
                inferenceReason = 'euro_symbol_in_response';
            } else if (text.includes('£')) {
                inferenceReason = 'pound_symbol_in_response';
            } else if (text.includes('฿') || text.includes('บาท')) {
                inferenceReason = 'baht_symbol_in_response';
            } else if (text.includes('¥') || text.includes('円')) {
                inferenceReason = 'yen_symbol_in_response';
            } else {
                inferenceReason = 'ai_detected';
            }
        }

        // タイ暦の変換（dateがタイ暦形式の場合）
        let date = parsedData.date || '';
        if (date && (date.includes('256') || date.includes('257'))) {
            // タイ暦年を検出（2568年など）
            const thaiYearMatch = date.match(/(\d{4})/);
            if (thaiYearMatch) {
                const thaiYear = parseInt(thaiYearMatch[1], 10);
                if (thaiYear > 2500) {
                    // タイ暦と判断（2500年以降はタイ暦の可能性が高い）
                    const westernYear = thaiYear - 543;
                    date = date.replace(thaiYear.toString(), westernYear.toString());
                    console.log(`Converted Thai year ${thaiYear} to Western year ${westernYear}`);
                }
            }
        }

        return NextResponse.json({
            vendor: parsedData.vendor || '',
            amount: amount,
            currency: currency,
            date: date,
            time: parsedData.time || '',
            invoice_number: parsedData.invoice_number || '',
            corners: corners,
            inference_reason: inferenceReason || null, // 通貨判定の推論理由
            rawText: text, // デバッグ用
        });
    } catch (error) {
        // エラーの詳細をログに出力
        console.error('=== OCR API ERROR START ===');
        console.error('OCR API error:', error);
        console.error('Error type:', error instanceof Error ? error.constructor.name : typeof error);
        console.error('Error message:', error instanceof Error ? error.message : String(error));
        console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');

        // エラーオブジェクトの全プロパティを出力
        if (error instanceof Error) {
            console.error('Error properties:', Object.getOwnPropertyNames(error));
        }

        // APIキーの状態を再確認
        console.error('API Key check at error time:', {
            hasApiKey: !!process.env.GEMINI_API_KEY,
            apiKeyLength: process.env.GEMINI_API_KEY?.length || 0,
            apiKeyPrefix: process.env.GEMINI_API_KEY?.substring(0, 10) || 'N/A'
        });

        console.error('=== OCR API ERROR END ===');

        // より詳細なエラーメッセージを返す
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorName = error instanceof Error ? error.name : 'UnknownError';

        // エラーデータを構築（必ずuserMessageを含める）
        const errorDetails = {
            error: 'Failed to process image',
            message: errorMessage,
            userMessage: '画像の処理中にエラーが発生しました。',
            details: 'エラーの詳細を確認してください。',
            type: errorName,
        };

        // エラーメッセージに基づいてユーザーフレンドリーなメッセージを設定
        const lowerErrorMessage = errorMessage.toLowerCase();
        const errorString = String(error);
        const lowerErrorString = errorString.toLowerCase();

        // 503エラー（サービス利用不可・過負荷）を最優先で検出
        if (lowerErrorMessage.includes('503') || lowerErrorMessage.includes('overloaded') ||
            lowerErrorMessage.includes('service unavailable') ||
            lowerErrorString.includes('503') || lowerErrorString.includes('overloaded') ||
            lowerErrorString.includes('service unavailable')) {
            errorDetails.userMessage = 'モデルが過負荷のため、しばらく待ってから再度お試しください。';
            errorDetails.details = 'Gemini APIのモデルが一時的に過負荷状態です。数秒から数分待ってから再度お試しください。';
            errorDetails.type = 'ServiceUnavailableError';
        } else if (lowerErrorMessage.includes('429') || lowerErrorMessage.includes('quota') ||
            lowerErrorMessage.includes('rate limit') || lowerErrorMessage.includes('rate_limit') ||
            lowerErrorString.includes('429') || lowerErrorString.includes('quota') ||
            lowerErrorString.includes('rate limit')) {
            // 429エラー（レート制限）を検出
            errorDetails.userMessage = 'APIの利用制限に達しました。';
            errorDetails.details = '無料プランでは1分あたりのリクエスト数に制限があります。しばらく待ってから再度お試しください。';
            errorDetails.type = 'RateLimitError';
        } else if (lowerErrorMessage.includes('404') || lowerErrorMessage.includes('not found')) {
            errorDetails.userMessage = '指定されたモデルが見つかりませんでした。';
            errorDetails.details = 'モデル名を確認してください: gemini-2.5-flash';
        } else if (lowerErrorMessage.includes('api') || lowerErrorMessage.includes('key') ||
            lowerErrorMessage.includes('auth') || lowerErrorMessage.includes('unauthorized') ||
            lowerErrorMessage.includes('401') || lowerErrorMessage.includes('403') ||
            lowerErrorString.includes('api key') || lowerErrorString.includes('authentication')) {
            errorDetails.userMessage = 'APIキーの設定を確認してください。';
            errorDetails.details = '.env.localファイルにGEMINI_API_KEYが正しく設定されているか確認してください。開発サーバーを再起動してください。';
        } else if (lowerErrorMessage.includes('network') || lowerErrorMessage.includes('fetch') ||
            lowerErrorMessage.includes('timeout')) {
            errorDetails.userMessage = 'ネットワークエラーが発生しました。';
            errorDetails.details = 'インターネット接続を確認してください。';
        } else {
            // 不明なエラーの場合、より詳細な情報を提供
            errorDetails.userMessage = '画像の処理中にエラーが発生しました。';
            errorDetails.details = `エラー詳細: ${errorMessage.substring(0, 200)}`;
        }

        // デバッグ用のエラーデータを追加（開発環境のみ）
        if (process.env.NODE_ENV === 'development') {
            (errorDetails as any).errorData = errorMessage;
            (errorDetails as any).stack = error instanceof Error ? error.stack : undefined;
        }

        // 確実にJSONレスポンスを返す
        try {
            return NextResponse.json(
                errorDetails,
                {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                    }
                }
            );
        } catch (jsonError) {
            // JSONレスポンスの作成に失敗した場合のフォールバック
            console.error('Failed to create JSON response:', jsonError);
            return new NextResponse(
                JSON.stringify({
                    error: 'Failed to process image',
                    message: 'Internal server error',
                    userMessage: 'サーバーエラーが発生しました。',
                    details: 'Please check server logs for details'
                }),
                {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                    }
                }
            );
        }
    }
}
