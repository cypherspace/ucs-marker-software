// The names of the main areas, in one place so the navigation bar, page titles, breadcrumbs and "Back to ..." links agree.
export const NAV = {
  home: 'Home',
  marking: 'Marking',
  myMarking: 'My marking',
  aiMarking: 'AI marking',
  comparative: 'Comparative ranking',
  examAdmin: 'Exam Admin',
  allExams: 'All exams',
  newExam: 'New exam',
  systemAdmin: 'System Admin',
  practiceMarking: 'Practice marking',
} as const;

// The System Admin sections: each is a real address (/admin?tab=...) so it can be linked and survives a reload
export const ADMIN_TABS = [
  { id: 'staff', label: 'Staff' },
  { id: 'overview', label: 'Marking overview' },
  { id: 'activity', label: 'Activity' },
  { id: 'storage', label: 'Storage' },
] as const;
export type AdminTab = (typeof ADMIN_TABS)[number]['id'];
export const isAdminTab = (v: string | null): v is AdminTab => ADMIN_TABS.some((t) => t.id === v);
