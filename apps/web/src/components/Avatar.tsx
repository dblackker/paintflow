import { ReactNode } from 'react';

interface AvatarProps {
  src?: string;
  alt?: string;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export function Avatar({ src, alt, name, size = 'md', className = '' }: AvatarProps) {
  const sizes = {
    xs: 'h-6 w-6 text-xs',
    sm: 'h-8 w-8 text-sm',
    md: 'h-10 w-10 text-base',
    lg: 'h-12 w-12 text-lg',
    xl: 'h-16 w-16 text-xl',
  };
  
  const getInitials = (name?: string) => {
    if (!name) return '?';
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };
  
  const getColor = (name?: string) => {
    if (!name) return 'bg-gray-500';
    const colors = [
      'bg-red-500',
      'bg-yellow-500',
      'bg-green-500',
      'bg-blue-500',
      'bg-indigo-500',
      'bg-purple-500',
      'bg-pink-500',
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };
  
  if (src) {
    return (
      <img
        src={src}
        alt={alt || name || 'Avatar'}
        className={`rounded-full object-cover ${sizes[size]} ${className}`}
      />
    );
  }
  
  return (
    <div
      className={`rounded-full flex items-center justify-center text-white font-medium ${sizes[size]} ${getColor(name)} ${className}`}
    >
      {getInitials(name)}
    </div>
  );
}

interface AvatarGroupProps {
  avatars: Array<{ src?: string; name?: string }>;
  max?: number;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export function AvatarGroup({ avatars, max = 3, size = 'md', className = '' }: AvatarGroupProps) {
  const displayAvatars = avatars.slice(0, max);
  const remaining = avatars.length - max;
  
  const sizes = {
    xs: '-space-x-1',
    sm: '-space-x-2',
    md: '-space-x-2',
    lg: '-space-x-3',
    xl: '-space-x-4',
  };
  
  return (
    <div className={`flex ${sizes[size]} ${className}`}>
      {displayAvatars.map((avatar, index) => (
        <Avatar
          key={index}
          src={avatar.src}
          name={avatar.name}
          size={size}
          className="ring-2 ring-white"
        />
      ))}
      {remaining > 0 && (
        <div className={`${size === 'xs' ? 'h-6 w-6 text-xs' : size === 'sm' ? 'h-8 w-8 text-sm' : size === 'md' ? 'h-10 w-10 text-base' : size === 'lg' ? 'h-12 w-12 text-lg' : 'h-16 w-16 text-xl'} rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-medium ring-2 ring-white`}>
          +{remaining}
        </div>
      )}
    </div>
  );
}
