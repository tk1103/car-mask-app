import { GET as detectPlateGET, POST as detectPlatePOST } from '../detect-plate/route';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = detectPlateGET;
export const POST = detectPlatePOST;
