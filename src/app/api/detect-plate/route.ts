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

    // Geminiへの最強プロンプト（日本のナンバープレート特化型）
    const prompt = `
      DETECT_LICENSE_PLATE_TASK:
      1. 分析対象: 画像内の「日本の自動車用ナンバープレート（白・黄色・緑）」を特定してください。
      2. 座標定義: 
         - 画像の左上を [0, 0]、右下を [1000, 1000] とする正規化座標を使用せよ。
         - ナンバープレートの外枠ギリギリを囲むバウンディングボックスを算出せよ。
      3. 出力形式: 
         - 思考プロセスや挨拶は一切不要。
         - 以下の純粋なJSON形式のみを出力せよ。
      
      {
        "found": true,
        "bbox": {
          "ymin": [上端のY座標],
          "xmin": [左端のX座標],
          "ymax": [下端のY座標],
          "xmax": [右端のX座標]
        }
      }

      ※プレートが画像内に存在しない、または不明瞭な場合は必ず {"found": false} とのみ出力してください。
    `;

    // REST API (v1) で直接呼び出し
    // ※ 利用可能性の高いビジョン対応モデルを使用（1.0 pro vision latest）
    const modelName = 'gemini-1.0-pro-vision-latest';
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
      }),
    });

    if (!geminiResponse.ok) {
      const errorBody = await geminiResponse.text();
      console.error('Gemini HTTP error:', geminiResponse.status, errorBody);
      return NextResponse.json(
        {
          found: false,
          error: 'Gemini API HTTPエラー',
          status: geminiResponse.status,
          rawResponse: errorBody,
        },
        { status: 500 }
      );
    }

    const geminiJson: any = await geminiResponse.json();
    const text =
      geminiJson.candidates?.[0]?.content?.parts
        ?.map((p: any) => p.text || '')
        .join('') ?? '';

    // JSONを抽出（```json や ``` を除去）
    let jsonText = text.trim();
    if (jsonText.includes('```json')) {
      jsonText = jsonText.split('```json')[1].split('```')[0].trim();
    } else if (jsonText.includes('```')) {
      jsonText = jsonText.split('```')[1].split('```')[0].trim();
    }

    try {
      const parsed = JSON.parse(jsonText);
      
      // 正規化座標（0-1000）をピクセル座標に変換
      // xmin, ymin, xmax, ymax形式からx, y, width, height形式に変換
      if (parsed.found && parsed.bbox && parsed.bbox.xmin !== undefined) {
        const xmin = Math.round((parsed.bbox.xmin / 1000) * imageWidth);
        const ymin = Math.round((parsed.bbox.ymin / 1000) * imageHeight);
        const xmax = Math.round((parsed.bbox.xmax / 1000) * imageWidth);
        const ymax = Math.round((parsed.bbox.ymax / 1000) * imageHeight);
        
        parsed.bbox = {
          x: xmin,
          y: ymin,
          width: xmax - xmin,
          height: ymax - ymin,
        };
      }
      
      return NextResponse.json(parsed);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.error('Response text:', text);
      // JSONパースに失敗した場合、テキストから座標を抽出を試みる
      return NextResponse.json({ 
        found: false, 
        error: '座標の解析に失敗しました',
        rawResponse: text 
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
