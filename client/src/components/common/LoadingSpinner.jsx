import React from 'react';
import { Loader2 } from 'lucide-react';

export const LoadingSpinner = ({ label = 'Loading...', size = 'md' }) => {
  const sizes = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12'
  };

  return (
    <div className="flex flex-col items-center justify-center p-6 text-slate-500">
      <Loader2 className={`${sizes[size]} animate-spin text-brand-600 mb-2`} />
      {label && <p className="text-sm font-medium text-slate-600">{label}</p>}
    </div>
  );
};

export default LoadingSpinner;
