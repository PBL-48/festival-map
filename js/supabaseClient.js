// 全ページで共通して使うSupabaseクライアント。
// ビルド不要のESモジュールとして、CDN(esm.sh)から直接読み込みます。
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../supabase-config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);