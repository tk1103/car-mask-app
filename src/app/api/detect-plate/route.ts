import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';

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

    // Gemini APIを初期化
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    // プロンプト: 日本のナンバープレートの座標を取得（最強プロンプト）
    const prompt = `あなたは自動車のプロカメラマンです。送られた画像から「日本のナンバープレート」の位置を正確に特定してください。

日本のナンバープレートの特徴：
- 白い長方形のプレート（軽自動車は黄色）
- 横長の長方形形状
- 数字とひらがな/カタカナが記載されている
- 通常、車の前部または後部に取り付けられている

画像サイズ: 幅 ${imageWidth}px × 高さ ${imageHeight}px

ナンバープレートが見つかった場合、以下のJSON形式で座標を返してください：
{
  "found": true,
  "bbox": {
    "x": ナンバープレートの左端のX座標（0から1000の正規化座標）,
    "y": ナンバープレートの上端のY座標（0から1000の正規化座標）,
    "width": ナンバープレートの幅（0から1000の正規化座標）,
    "height": ナンバープレートの高さ（0から1000の正規化座標）
  }
}

ナンバープレートが見つからない場合：
{
  "found": false
}

重要：
- 座標は画像全体を1000とした正規化座標で返してください（例：画像の中央は x=500, y=500）
- 画像の左上を(0,0)とします
- JSON形式のみを返し、説明文やマークダウン記号（\`\`\`json など）は一切含めないでください
- 返答は必ず有効なJSON形式のみです`;

    const result = await model.generateContent([
      {
        inlineData: {
          data: base64Image,
          mimeType: mimeType,
        },
      },
      prompt,
    ]);

    const response = await result.response;
    const text = response.text();

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
      if (parsed.found && parsed.bbox) {
        parsed.bbox = {
          x: Math.round((parsed.bbox.x / 1000) * imageWidth),
          y: Math.round((parsed.bbox.y / 1000) * imageHeight),
          width: Math.round((parsed.bbox.width / 1000) * imageWidth),
          height: Math.round((parsed.bbox.height / 1000) * imageHeight),
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
