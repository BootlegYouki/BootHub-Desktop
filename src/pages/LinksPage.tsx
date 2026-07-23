import React from 'react';
import { BasePage, BasePageProps } from './BasePage';

export const LinksPage: React.FC<Omit<BasePageProps, 'activeTab'>> = (props) => {
  return <BasePage activeTab="link" {...props} />;
};
