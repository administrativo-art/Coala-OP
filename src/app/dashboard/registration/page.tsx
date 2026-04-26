"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RegistrationPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace('/dashboard/settings?department=operacional&tab=cadastros');
    }, [router]);

    return null;
}
