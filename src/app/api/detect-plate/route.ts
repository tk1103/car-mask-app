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

    // Geminiへのプロンプト（厳格な四隅指定）
    const prompt = `
  DETECT_LICENSE_PLATE_CORNERS:
  1. 画像内の日本のナンバープレートの「四隅」を正確に特定してください。
  2. 座標は[0, 0]（左上）から[1000, 1000]（右下）の範囲で答えてください。
  3. 出力は必ず以下のJSON形式のみとし、マークダウン記法（\`\`\`json）も不要です。

  {
    "found": true,
    "corners": [
      {"x": 左上のX, "y": 左上のY},
      {"x": 右上のX, "y": 右上のY},
      {"x": 右下のX, "y": 右下のY},
      {"x": 左下のX, "y": 左下のY}
    ]
  }

  ※見つからない場合は {"found": false} と返してください。
`;

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
      
      if (parsed.found && parsed.corners && Array.isArray(parsed.corners) && parsed.corners.length === 4) {
        console.log('Corners (normalized 0-1000):', parsed.corners);
      } else {
        console.log('No corners in parsed result:', parsed);
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
