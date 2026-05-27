import {
  ArrowRight,
  BarChart3,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  CreditCard,
  FileText,
  Info,
  LayoutTemplate,
  LoaderCircle,
  Mail,
  MapPin,
  Menu,
  MessageSquare,
  Minus,
  MoreHorizontal,
  PaintBucket,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Snowflake,
  Sun,
  Thermometer,
  Trash2,
  TriangleAlert,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';

interface IconProps {
  name: string;
  className?: string;
}

const icons: Record<string, LucideIcon> = {
  'arrow-right': ArrowRight,
  'bar-chart': BarChart3,
  bell: Bell,
  briefcase: BriefcaseBusiness,
  calendar: CalendarDays,
  check: Check,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  clock: Clock3,
  close: X,
  'cloud-drizzle': CloudDrizzle,
  'cloud-fog': CloudFog,
  'cloud-lightning': CloudLightning,
  'cloud-rain': CloudRain,
  'cloud-sun': CloudSun,
  cloud: Cloud,
  'credit-card': CreditCard,
  edit: Pencil,
  'file-text': FileText,
  info: Info,
  loader: LoaderCircle,
  mail: Mail,
  'map-pin': MapPin,
  menu: Menu,
  message: MessageSquare,
  minus: Minus,
  'more-horizontal': MoreHorizontal,
  'paint-bucket': PaintBucket,
  phone: Phone,
  plus: Plus,
  refresh: RefreshCw,
  search: Search,
  settings: Settings,
  snowflake: Snowflake,
  sun: Sun,
  templates: LayoutTemplate,
  thermometer: Thermometer,
  trash: Trash2,
  users: Users,
  warning: TriangleAlert,
};

export function Icon({ name, className = 'h-5 w-5' }: IconProps) {
  const Component = icons[name] || CircleHelp;

  return (
    <Component
      aria-hidden="true"
      className={className}
      focusable="false"
      strokeWidth={2}
    />
  );
}
