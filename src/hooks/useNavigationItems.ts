import { Home, MessageSquare, AppWindow, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  id: string;
  path: string;
  label: string;
  icon: LucideIcon;
  getTag?: () => string;
  tagAlign?: 'left' | 'right';
  hasSubItems?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'home', path: '/', label: 'Home', icon: Home },
  { id: 'chat', path: '/pair', label: 'Chat', icon: MessageSquare, hasSubItems: true },
  { id: 'apps', path: '/apps', label: 'Apps', icon: AppWindow },
  { id: 'settings', path: '/settings', label: 'Settings', icon: Settings },
];

export function getNavItemById(id: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.id === id);
}
