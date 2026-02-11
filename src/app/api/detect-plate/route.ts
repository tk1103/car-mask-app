import { NextRequest, NextResponse } from 'next/server';

// 明示的に Node.js ランタイムを指定（process.env を確実に使うため）
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const imageFile = formData.get('image') as File;
    const imageWidth = parseInt(formData.get('width') as string) || 0;
    const imageHeight = parseInt(formData.get('height') as string) || 0;
    
    if (!imageFile) {
      return NextResponse.json({ error: '画像が送信されませんでした' }, { status: 400 });
    }

    if (!imageWidth || !imageHeight) {
      return NextResponse.json({ error: '画像サイズが送信されませんでした' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEYが設定されていません' }, { status: 500 });
    }

    // 画像をbase64に変換
    const arrayBuffer = await imageFile.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = imageFile.type || 'image/jpeg';

    // Geminiへのプロンプト（厳格な四隅指定・精度向上版）
    const prompt = `TASK: Detect the exact four corners of the Japanese license plate in the image for privacy masking.

ANALYSIS STEPS:
1. Identify the rectangular boundary of the license plate (ナンバープレート).
2. Locate the four specific corner points: Top-Left, Top-Right, Bottom-Right, and Bottom-Left.
3. If multiple plates exist, detect ALL of them and return each as a separate entry in the plates array.

COORDINATE SYSTEM:
- Return coordinates in a normalized range of 0 to 1000.
- [x: 0, y: 0] is the Top-Left corner of the image.
- [x: 1000, y: 1000] is the Bottom-Right corner of the image.

OUTPUT FORMAT (JSON only):
{
  "found": true/false,
  "plates": [
    {
      "corners": [
        {"x": number, "y": number}, // 1. Top-Left
        {"x": number, "y": number}, // 2. Top-Right
        {"x": number, "y": number}, // 3. Bottom-Right
        {"x": number, "y": number}  // 4. Bottom-Left
      ]
    }
  ]
}

STRICT RULES:
- Only return the license plate boundary, NOT the car body or headlights.
- If no plate is clearly visible, return {"found": false, "plates": []}.
- Do not include any conversational text or markdown code blocks.
- If multiple plates exist, return all of them in the plates array.
- Detect plates even if they are small, slanted, or partially obscured.
- Return coordinates in the exact order: Top-Left, Top-Right, Bottom-Right, Bottom-Left.`;

    // REST API (v1) で直接呼び出し
    // ListModels で確認できたマルチモーダル対応モデルを使用
    const modelName = 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${apiKey}`;

    const geminiResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  data: base64Image,
                  mimeType,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0, // より一貫性のある結果のため
          topP: 0.95,
          topK: 40,
        },
      }),
    });

    if (!geminiResponse.ok) {
      let errorBody: string;
      let errorJson: any = null;
      
      try {
        errorBody = await geminiResponse.text();
        // JSONとしてパースを試みる
        try {
          errorJson = JSON.parse(errorBody);
        } catch {
          // JSONでない場合はそのまま使用
        }
      } catch (e) {
        errorBody = `エラーレスポンスの読み取りに失敗: ${e instanceof Error ? e.message : String(e)}`;
      }
      
      console.error('Gemini HTTP error:', geminiResponse.status, errorBody);
      
      // エラーメッセージを抽出
      let errorMessage = 'Gemini API HTTPエラー';
      if (errorJson?.error?.message) {
        errorMessage = errorJson.error.message;
      } else if (errorJson?.error) {
        errorMessage = String(errorJson.error);
      }
      
      return NextResponse.json(
        {
          found: false,
          error: errorMessage,
          status: geminiResponse.status,
          rawResponse: errorBody.substring(0, 1000), // 最初の1000文字のみ
        },
        { status: geminiResponse.status === 429 ? 429 : 500 }
      );
    }

    let geminiJson: any;
    try {
      geminiJson = await geminiResponse.json();
    } catch (jsonError) {
      console.error('Failed to parse Gemini response as JSON:', jsonError);
      const text = await geminiResponse.text();
      return NextResponse.json({
        found: false,
        error: 'Gemini APIの応答を解析できませんでした',
        rawResponse: text.substring(0, 500),
      }, { status: 500 });
    }
    
    const text =
      geminiJson.candidates?.[0]?.content?.parts
        ?.map((p: any) => p.text || '')
        .join('') ?? '';

    // テキストが空の場合はエラー
    if (!text || text.trim().length === 0) {
      console.error('Empty response from Gemini API:', geminiJson);
      return NextResponse.json({
        found: false,
        error: 'Gemini APIから空の応答が返されました',
        rawResponse: JSON.stringify(geminiJson).substring(0, 500),
      });
    }

    console.log('Gemini API raw text response:', text.substring(0, 500)); // 最初の500文字をログ

    // JSONを抽出（```json や ``` を除去）
    let jsonText = text.trim();
    if (jsonText.includes('```json')) {
      jsonText = jsonText.split('```json')[1].split('```')[0].trim();
    } else if (jsonText.includes('```')) {
      jsonText = jsonText.split('```')[1].split('```')[0].trim();
    }

    // デバッグ: 抽出されたJSONテキストを確認
    console.log('Extracted JSON text:', jsonText.substring(0, 200));

    try {
      const parsed = JSON.parse(jsonText);
      console.log('Parsed JSON:', JSON.stringify(parsed));
      
      // 複数プレート対応：plates配列または単一cornersの両方に対応
      if (parsed.found) {
        if (parsed.plates && Array.isArray(parsed.plates)) {
          console.log(`Found ${parsed.plates.length} plate(s) (normalized 0-1000)`);
        } else if (parsed.corners && Array.isArray(parsed.corners) && parsed.corners.length === 4) {
          // 後方互換性：単一corners形式をplates配列に変換
          parsed.plates = [{ corners: parsed.corners }];
          delete parsed.corners;
          console.log('Converted single corners to plates array');
        } else {
          console.log('No plates found in parsed result:', parsed);
        }
      }
      
      return NextResponse.json(parsed);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.error('Response text (full):', text);
      // JSONパースに失敗した場合、テキストから座標を抽出を試みる
      return NextResponse.json({ 
        found: false, 
        error: '座標の解析に失敗しました',
        rawResponse: text.substring(0, 500) // 最初の500文字のみ返す
      });
    }
  } catch (error) {
    console.error('Gemini API error:', error);
    return NextResponse.json(
      { error: 'ナンバープレートの検出に失敗しました', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
