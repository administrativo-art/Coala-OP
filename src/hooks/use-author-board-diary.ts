
"use client";

import { useContext } from 'react';
import { AuthorBoardDiaryContext, type AuthorBoardDiaryContextType } from '@/components/author-board-diary-provider';

export const useAuthorBoardDiary = (): AuthorBoardDiaryContextType => {
  const context = useContext(AuthorBoardDiaryContext);
  if (context === undefined) {
    throw new Error('useAuthorBoardDiary must be used within a AuthorBoardDiaryProvider');
  }
  return context;
};
