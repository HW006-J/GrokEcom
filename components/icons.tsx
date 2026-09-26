type P = { size?: number; className?: string };
const s = (n = 20) => ({ width: n, height: n, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const });

export const X = ({ size, className }: P) => (<svg {...s(size)} className={className}><path d="M18 6 6 18M6 6l12 12" /></svg>);
export const Flash = ({ size, className }: P) => (<svg {...s(size)} className={className}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></svg>);
export const Flip = ({ size, className }: P) => (<svg {...s(size)} className={className}><path d="M21 8a9 9 0 0 0-15-3L3 8M3 16a9 9 0 0 0 15 3l3-3" /><path d="M3 4v4h4M21 20v-4h-4" /></svg>);
export const Chevron = ({ size, className }: P) => (<svg {...s(size)} className={className}><path d="m9 6 6 6-6 6" /></svg>);
export const ChevronUp = ({ size, className }: P) => (<svg {...s(size)} className={className}><path d="m6 15 6-6 6 6" /></svg>);
export const Scan = ({ size, className }: P) => (<svg {...s(size)} className={className}><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /></svg>);
export const Grid = ({ size, className }: P) => (<svg {...s(size)} className={className}><rect x="4" y="4" width="7" height="7" rx="1.6" /><rect x="13" y="4" width="7" height="7" rx="1.6" /><rect x="4" y="13" width="7" height="7" rx="1.6" /><rect x="13" y="13" width="7" height="7" rx="1.6" /></svg>);
export const List = ({ size, className }: P) => (<svg {...s(size)} className={className}><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>);
export const Heart = ({ size, className }: P) => (<svg {...s(size)} className={className}><path d="M12 20s-7-4.6-7-9.3A4 4 0 0 1 12 7a4 4 0 0 1 7 3.7C19 15.4 12 20 12 20Z" /></svg>);
export const Dots = ({ size, className }: P) => (<svg {...s(size)} className={className}><circle cx="5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="19" cy="12" r="1.3" fill="currentColor" /></svg>);
export const Users = ({ size, className }: P) => (<svg {...s(size)} className={className}><path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19" /><circle cx="10" cy="8" r="3.2" /><path d="M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 5.2a3.2 3.2 0 0 1 0 5.6" /></svg>);
export const Clock = ({ size, className }: P) => (<svg {...s(size)} className={className}><circle cx="12" cy="12" r="8.2" /><path d="M12 7.6V12l2.8 1.8" /></svg>);
export const Pause = ({ size, className }: P) => (<svg {...s(size)} className={className}><path d="M9.5 6v12M14.5 6v12" strokeWidth="2" /></svg>);
export const Play = ({ size, className }: P) => (<svg {...s(size)} className={className}><path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" /></svg>);
export const Check = ({ size, className }: P) => (<svg {...s(size)} className={className}><path d="m5 12.5 4.5 4.5L19 7" strokeWidth="2.4" /></svg>);
export const Share = ({ size, className }: P) => (<svg {...s(size)} className={className}><path d="M12 15V4M8.5 7.5 12 4l3.5 3.5" /><path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" /></svg>);
