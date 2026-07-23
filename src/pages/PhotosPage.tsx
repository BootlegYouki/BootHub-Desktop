import React from 'react';
import { BasePage, BasePageProps } from './BasePage';

export const PhotosPage: React.FC<Omit<BasePageProps, 'activeTab'>> = (props) => {
  return <BasePage activeTab="photo" {...props} />;
};
