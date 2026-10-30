import { redirect } from 'next/navigation';
import { buildPreservedRoute } from '../features/embed/chatbot-bridge';

export default function HomePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
} = {}) {
  if (searchParams && Object.keys(searchParams).length > 0) {
    const qs = new URLSearchParams();
    for (const [key, val] of Object.entries(searchParams)) {
      if (typeof val === 'string' && val.trim()) {
        qs.set(key, val.trim());
      } else if (Array.isArray(val) && val[0]?.trim()) {
        qs.set(key, val[0].trim());
      }
    }
    const queryStr = qs.toString();
    if (queryStr) {
      redirect(buildPreservedRoute('/login', `?${queryStr}`));
    }
  }
  redirect('/login');
}
