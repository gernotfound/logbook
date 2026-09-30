import {
  handleAccountDeletionGet,
  handleAccountDeletionPost,
} from '../functions/src/accountDeletion/http.js';

export async function POST(request: Request): Promise<Response> {
  return handleAccountDeletionPost(request);
}

export async function GET(request: Request): Promise<Response> {
  return handleAccountDeletionGet(request);
}
