import React from 'react';
import { BasePage, BasePageProps } from './BasePage';

export const TextsPage: React.FC<Omit<BasePageProps, 'activeTab'>> = (props) => {
  return <BasePage activeTab="text" {...props} />;
};
