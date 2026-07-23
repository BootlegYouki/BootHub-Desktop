import React from 'react';
import { BasePage, BasePageProps } from './BasePage';

export const FilesPage: React.FC<Omit<BasePageProps, 'activeTab'>> = (props) => {
  return <BasePage activeTab="file" {...props} />;
};
