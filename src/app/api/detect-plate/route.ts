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

    // Geminiへの最強プロンプト（日本のナンバープレート特化型・精度向上版）
    const prompt = `
あなたは日本の自動車ナンバープレート検出の専門家です。画像内の「日本の自動車用ナンバープレート」を高精度で検出してください。

【日本のナンバープレートの特徴】
- 白い長方形（軽自動車は黄色、営業用は緑）
- 横長の長方形（幅:高さ = 約3:1〜4:1）
- 数字とひらがな/カタカナが記載されている
- 通常、車の前部または後部の中央下部に取り付けられている
- 反射材で光っている場合がある
- 縁取り（枠）がある
- 車体のバンパーやグリル付近に配置される

【検出優先順位】
1. 車の前部/後部の中央下部にある横長の白/黄/緑の長方形
2. 数字と文字が読み取れるプレート（文字が小さくても検出）
3. 画面の下半分にあるプレート（上半分は通常、フロントガラスや背景）
4. 部分的に隠れていても、プレートの大部分が見えていれば検出

【検出の厳密さ】
- プレートが少し傾いていても検出してください
- 光の反射で見えにくくても、プレートの形状が分かれば検出してください
- 複数のプレートがある場合は、最も大きく、最も明確なものを検出してください

【座標定義】
- 画像の左上を [0, 0]、右下を [1000, 1000] とする正規化座標を使用
- ナンバープレートの外枠ギリギリを囲むバウンディングボックスを算出
- プレート全体（数字・文字・枠を含む）を正確に囲むこと
- 座標は整数値で出力してください

【出力形式】
思考プロセスや挨拶は一切不要。以下の純粋なJSON形式のみを出力してください。

{
  "found": true,
  "bbox": {
    "ymin": [上端のY座標（0-1000の整数）],
    "xmin": [左端のX座標（0-1000の整数）],
    "ymax": [下端のY座標（0-1000の整数）],
    "xmax": [右端のX座標（0-1000の整数）]
  }
}

プレートが画像内に存在しない、または不明瞭な場合は必ず {"found": false} とのみ出力してください。
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
        console.log('Converted bbox:', parsed.bbox);
      } else {
        console.log('No bbox found in parsed result:', parsed);
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
