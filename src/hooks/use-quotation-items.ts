import { useState, useEffect } from 'react';
import { type QuotationItem } from '@/types';
import { useAuth } from './use-auth';

export function useQuotationItems(quotationId: string | null) {
  const [items, setItems] = useState<QuotationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { firebaseUser } = useAuth();

  const fetchItems = async (cancelled = false) => {
    if (!quotationId) {
      if (!cancelled) {
        setItems([]);
        setLoading(false);
      }
      return;
    }
    if (!firebaseUser) {
      if (!cancelled) {
        setItems([]);
        setLoading(false);
      }
      return;
    }
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/purchasing/quotations/${quotationId}/items`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
      });
      if (!response.ok) return;
      const data = (await response.json()) as QuotationItem[];
      if (!cancelled) {
        setItems(data);
        setLoading(false);
      }
    } catch (error) {
      console.error('Error fetching quotation items:', error);
      if (!cancelled) {
        setItems([]);
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!quotationId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    let cancelled = false;
    void fetchItems(cancelled);
    return () => {
      cancelled = true;
    };
  }, [firebaseUser, quotationId]);

  const refresh = async () => {
    setLoading(true);
    await fetchItems(false);
  };

  return { items, loading, refresh };
}
