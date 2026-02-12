import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        // 環境変数からAPIキーを取得（.env.localに記載されている正確な変数名を使用）
        // ガード節: APIキーが未設定の場合は詳細なエラーを返す
        const apiKey = process.env.GEMINI_API_KEY;

        // デバッグ用: 環境変数の状態をログに出力（Vercel環境でも確認可能）
        console.log('Environment check:', {
            hasApiKey: !!apiKey,
            apiKeyLength: apiKey?.length || 0,
            nodeEnv: process.env.NODE_ENV,
            vercelEnv: process.env.VERCEL ? 'true' : 'false',
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

        // 本番環境ではAPIキーの情報をログに出力しない（セキュリティのため）
        if (process.env.NODE_ENV === 'development') {
            console.log('API key found, length:', apiKey.length, 'starts with:', apiKey.substring(0, 10) + '...');
        } else {
            console.log('API key found and configured');
        }

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

        // Gemini 2.0 は 2026年3月31日廃止のため、2.5 Flash に移行
        const modelName = 'gemini-2.5-flash';
        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "object" as const,
                    properties: {
                        found: { type: "boolean" as const, description: "Whether at least one license plate was detected" },
                        plates: {
                            type: "array" as const,
                            description: "List of detected license plates, each with four corner coordinates (0-1000)",
                            items: {
                                type: "object" as const,
                                properties: {
                                    corners: {
                                        type: "array" as const,
                                        description: "Four corners: Top-Left, Top-Right, Bottom-Right, Bottom-Left",
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
                                required: ["corners"]
                            }
                        }
                    },
                    required: ["found", "plates"]
                } as any
            }
        });

        console.log(`Using model: ${modelName} with JSON schema`);

        // ナンバープレート検知専用プロンプト（四隅の座標のみを返す）
        const prompt = `TASK: Detect the exact four corners of the Japanese license plate in the image for privacy masking.

ANALYSIS STEPS:
1. Identify the rectangular boundary of the license plate (ナンバープレート).
2. Locate the four specific corner points: Top-Left, Top-Right, Bottom-Right, and Bottom-Left.
3. If multiple plates exist, detect ALL of them and return each in the "plates" array (most prominent/foreground first).

COORDINATE SYSTEM:
- Return coordinates in a normalized range of 0 to 1000.
- [x: 0, y: 0] is the Top-Left corner of the image.
- [x: 1000, y: 1000] is the Bottom-Right corner of the image.

OUTPUT FORMAT (JSON only). Use "found" and "plates". Each plate has "corners" with exactly 4 points in order: Top-Left, Top-Right, Bottom-Right, Bottom-Left:
{
  "found": true,
  "plates": [
    {
      "corners": [
        {"x": number, "y": number},
        {"x": number, "y": number},
        {"x": number, "y": number},
        {"x": number, "y": number}
      ]
    }
  ]
}

STRICT RULES:
- Only return the license plate boundary, NOT the car body or headlights.
- If no plate is clearly visible, return {"found": false, "plates": []}.
- Do not include any conversational text or markdown code blocks.`;

        // 画像とプロンプトを送信
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
                const isVercel = process.env.VERCEL === '1';
                return NextResponse.json({
                    error: 'Authentication failed',
                    message: 'APIキーの認証に失敗しました',
                    userMessage: 'APIキーの設定を確認してください。',
                    details: isVercel 
                        ? 'Vercelの環境変数設定でGEMINI_API_KEYが正しく設定されているか確認してください。Settings > Environment Variablesで確認してください。'
                        : '.env.localファイルにGEMINI_API_KEYが正しく設定されているか確認してください。開発サーバーを再起動してください。',
                    type: 'AuthenticationError',
                    status: 401,
                    isVercel: isVercel
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

        // ナンバープレート用: found と plates の検証
        const found = parsedData.found === true;
        let plates = parsedData.plates;

        if (!Array.isArray(plates)) {
            plates = [];
        }

        // 各プレートの corners を検証（4点・0-1000 の座標）
        const validPlates = plates
            .filter((plate: any) => plate && Array.isArray(plate.corners) && plate.corners.length === 4)
            .map((plate: any) => {
                const validCorners = plate.corners.every((c: any) =>
                    c && typeof c.x === 'number' && typeof c.y === 'number' &&
                    c.x >= 0 && c.x <= 1000 && c.y >= 0 && c.y <= 1000
                );
                if (!validCorners) return null;
                return { corners: plate.corners };
            })
            .filter(Boolean);

        return NextResponse.json({
            found: found && validPlates.length > 0,
            plates: validPlates,
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

        // APIキーの状態を再確認（本番環境では詳細を出力しない）
        if (process.env.NODE_ENV === 'development') {
            console.error('API Key check at error time:', {
                hasApiKey: !!process.env.GEMINI_API_KEY,
                apiKeyLength: process.env.GEMINI_API_KEY?.length || 0,
                apiKeyPrefix: process.env.GEMINI_API_KEY?.substring(0, 10) || 'N/A'
            });
        } else {
            console.error('API Key check at error time:', {
                hasApiKey: !!process.env.GEMINI_API_KEY
            });
        }

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
            const isVercel = process.env.VERCEL === '1';
            errorDetails.userMessage = 'APIキーの設定を確認してください。';
            errorDetails.details = isVercel
                ? 'Vercelの環境変数設定でGEMINI_API_KEYが正しく設定されているか確認してください。Settings > Environment Variablesで確認してください。'
                : '.env.localファイルにGEMINI_API_KEYが正しく設定されているか確認してください。開発サーバーを再起動してください。';
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
