import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

export const runtime = 'nodejs';

// 一時画像を保存するディレクトリ
const UPLOAD_DIR = join(process.cwd(), 'public', 'temp');

// ディレクトリが存在しない場合は作成
if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const imageFile = formData.get('image') as File;
    
    if (!imageFile) {
      return NextResponse.json({ error: '画像が送信されませんでした' }, { status: 400 });
    }

    // 一時ファイル名を生成（タイムスタンプ + ランダム文字列）
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    const filename = `share-${timestamp}-${random}.jpg`;
    const filepath = join(UPLOAD_DIR, filename);

    // 画像を保存
    const arrayBuffer = await imageFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await writeFile(filepath, buffer);

    // 公開URLを返す
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
                    (request.headers.get('origin') || 'http://localhost:3000');
    const imageUrl = `${baseUrl}/temp/${filename}`;

    return NextResponse.json({ 
      success: true, 
      url: imageUrl,
      filename 
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: '画像のアップロードに失敗しました', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
