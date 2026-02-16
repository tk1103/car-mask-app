import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// 2026年3月の2.0系廃止を見越し、Gemini 3 系に統一（安定版は gemini-3-flash に切り替え可）
const MODEL_NAME = 'gemini-3-flash-preview';

// ナンバープレート検知専用レスポンススキーマ: found + plates[]（各要素は found と corners: {x,y}[]）
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    found: {
      type: 'boolean',
      description: '画像内に1つ以上ナンバープレートが検出された場合true',
    },
    plates: {
      type: 'array',
      description: '検出したナンバープレートの配列。各要素は found と corners を持つ',
      items: {
        type: 'object',
        properties: {
          found: {
            type: 'boolean',
            description: '当該プレートが有効に検出された場合true',
          },
          corners: {
            type: 'array',
            description: '四隅の座標。時計回りに 左上・右上・右下・左下。0-1000で正規化',
            minItems: 4,
            maxItems: 4,
            items: {
              type: 'object',
              properties: {
                x: { type: 'number', minimum: 0, maximum: 1000, description: '横方向 0=左端 1000=右端' },
                y: { type: 'number', minimum: 0, maximum: 1000, description: '縦方向 0=上端 1000=下端' },
              },
              required: ['x', 'y'],
            },
          },
        },
        required: ['found', 'corners'],
      },
    },
  },
  required: ['found', 'plates'],
} as const;

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

    const arrayBuffer = await imageFile.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = imageFile.type || 'image/jpeg';

    // ナンバープレート検知専用プロンプト（レシート・領収書・他用途の記述は一切含めない）
    const prompt = `タスク: 画像内の日本のナンバープレート（自動車の登録番号標）の四隅のみを検出し、指定スキーマのJSONだけを返す。

座標系:
- 画像は幅 ${imageWidth}px・高さ ${imageHeight}px。座標は 0〜1000 で正規化する。
- x: 0=左端、1000=右端。y: 0=上端、1000=下端（画面座標。上端が0）。

検出対象:
- ナンバープレートのみ。上段（地域名・分類番号）と下段（ひらがな＋数字）を含む、プレートだけを囲む最小の四角形。
- 車体・モニター枠・周囲の余白は含めない。レシート・領収書・その他文書は対象外。

四隅の順序（厳守）:
- 時計回りに 左上 → 右上 → 右下 → 左下 の4点を返す。
- プレートが傾いている場合は、その傾きに合わせた四角形の4頂点をこの順で返す。

出力:
- プレートが1つも写っていない場合: found=false, plates=[]。
- 検出したプレートごとに plates に1要素ずつ、found=true と corners（4点の配列）を入れる。`;

    const url = `https://generativelanguage.googleapis.com/v1/models/${MODEL_NAME}:generateContent?key=${apiKey}`;

    const geminiResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inlineData: { data: base64Image, mimeType } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          topP: 0.95,
          topK: 40,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });

    if (!geminiResponse.ok) {
      let errorBody: string;
      let errorJson: any = null;
      try {
        errorBody = await geminiResponse.text();
        try {
          errorJson = JSON.parse(errorBody);
        } catch {
          // ignore
        }
      } catch (e) {
        errorBody = `エラーレスポンスの読み取りに失敗: ${e instanceof Error ? e.message : String(e)}`;
      }
      console.error('Gemini HTTP error:', geminiResponse.status, errorBody);

      let errorMessage = 'Gemini API HTTPエラー';
      if (errorJson?.error?.message) errorMessage = errorJson.error.message;
      else if (errorJson?.error) errorMessage = String(errorJson.error);

      const isQuota =
        geminiResponse.status === 429 ||
        /quota|rate limit|exceeded/i.test(String(errorMessage));
      const userMessage = isQuota
        ? '本日のAI利用回数（20回）に達しました。明日またお試しください。'
        : errorMessage;

      return NextResponse.json(
        {
          found: false,
          error: userMessage,
          status: geminiResponse.status,
          rawResponse: errorBody?.substring?.(0, 1000),
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
        ?.map((p: any) => p.text ?? '')
        .join('') ?? '';

    if (!text?.trim()) {
      console.error('Empty response from Gemini API:', geminiJson);
      return NextResponse.json({
        found: false,
        error: 'Gemini APIから空の応答が返されました',
        rawResponse: JSON.stringify(geminiJson).substring(0, 500),
      }, { status: 500 });
    }

    let jsonText = text.trim();
    if (jsonText.includes('```json')) {
      jsonText = jsonText.split('```json')[1]?.split('```')[0]?.trim() ?? jsonText;
    } else if (jsonText.includes('```')) {
      jsonText = jsonText.split('```')[1]?.split('```')[0]?.trim() ?? jsonText;
    }

    try {
      const parsed = JSON.parse(jsonText);

      if (parsed.found && Array.isArray(parsed.plates)) {
        const validPlates = parsed.plates.filter(
          (p: any) => p?.found && Array.isArray(p?.corners) && p.corners.length === 4
        );
        if (validPlates.length === 0) {
          parsed.found = false;
          parsed.plates = [];
        } else {
          parsed.plates = validPlates;
        }
        console.log(`Detect-plate: found=${parsed.found}, plates=${parsed.plates.length}`);
      } else if (parsed.found && !Array.isArray(parsed.plates)) {
        parsed.found = false;
        parsed.plates = [];
      }

      return NextResponse.json(parsed);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return NextResponse.json({
        found: false,
        error: '座標の解析に失敗しました',
        rawResponse: jsonText.substring(0, 500),
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Gemini API error:', error);
    return NextResponse.json(
      {
        error: 'ナンバープレートの検出に失敗しました',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
