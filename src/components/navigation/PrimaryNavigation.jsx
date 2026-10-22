// import React, { useState, useEffect } from 'react';
// import { Link, useLocation } from 'react-router-dom';
// import Icon from '../AppIcon';

// const PrimaryNavigation = () => {
//   const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
//   const location = useLocation();

//   useEffect(() => {
//     setIsMobileMenuOpen(false);
//   }, [location?.pathname]);

//   useEffect(() => {
//     if (isMobileMenuOpen) {
//       document.body.style.overflow = 'hidden';
//     } else {
//       document.body.style.overflow = 'unset';
//     }
//     return () => {
//       document.body.style.overflow = 'unset';
//     };
//   }, [isMobileMenuOpen]);

//   const navigationItems = [
//     {
//       label: 'New Scan',
//       path: '/upload-interface',
//       icon: 'Upload',
//       description: 'Upload and analyze new projects'
//     },
//     {
//       label: 'Results',
//       path: '/vulnerability-dashboard',
//       icon: 'Shield',
//       description: 'View vulnerability analysis'
//     },
//     {
//       label: 'History',
//       path: '/scan-history',
//       icon: 'History',
//       description: 'Review previous scans'
//     },
    
//   ];

//   const isActivePath = (path) => {
//     if (path === '/upload-interface') {
//       return location?.pathname === path || location?.pathname === '/scan-progress-tracking';
//     }
//     return location?.pathname === path;
//   };

//   const handleKeyDown = (e) => {
//     if (e?.key === 'Escape' && isMobileMenuOpen) {
//       setIsMobileMenuOpen(false);
//     }
//   };

//   useEffect(() => {
//     document.addEventListener('keydown', handleKeyDown);
//     return () => document.removeEventListener('keydown', handleKeyDown);
//   }, [isMobileMenuOpen]);

//   return (
//     <>
//       <nav className="primary-nav" role="navigation" aria-label="Primary navigation">
//         <div className="primary-nav-container">
//           <Link to="/upload-interface" className="primary-nav-logo" aria-label="CodeGuard Scanner Home">
//             <div className="primary-nav-logo-icon">
//               <Icon name="Shield" size={24} color="#ffffff" />
//             </div>
//             <span className="primary-nav-logo-text">CodeGuard Scanner</span>
//           </Link>

//           <div className="primary-nav-menu">
//             {navigationItems?.map((item) => (
//               <Link
//                 key={item?.path}
//                 to={item?.path}
//                 className={`primary-nav-link ${isActivePath(item?.path) ? 'active' : ''}`}
//                 aria-current={isActivePath(item?.path) ? 'page' : undefined}
//                 title={item?.description}
//               >
//                 <span className="flex items-center gap-2">
//                   <Icon name={item?.icon} size={18} />
//                   {item?.label}
//                 </span>
//               </Link>
//             ))}
//           </div>

//           <button
//             className="primary-nav-mobile-toggle"
//             onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
//             aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
//             aria-expanded={isMobileMenuOpen}
//             aria-controls="mobile-navigation"
//           >
//             <Icon name={isMobileMenuOpen ? 'X' : 'Menu'} size={24} />
//           </button>
//         </div>
//       </nav>
//       {isMobileMenuOpen && (
//         <div
//           className="primary-nav-mobile-menu"
//           id="mobile-navigation"
//           role="dialog"
//           aria-modal="true"
//           aria-label="Mobile navigation menu"
//         >
//           <div className="primary-nav-mobile-header">
//             <Link to="/upload-interface" className="primary-nav-logo" aria-label="CodeGuard Scanner Home">
//               <div className="primary-nav-logo-icon">
//                 <Icon name="Shield" size={24} color="#ffffff" />
//               </div>
//               <span className="primary-nav-logo-text">CodeGuard Scanner</span>
//             </Link>
//             <button
//               className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
//               onClick={() => setIsMobileMenuOpen(false)}
//               aria-label="Close menu"
//             >
//               <Icon name="X" size={24} />
//             </button>
//           </div>

//           <div className="primary-nav-mobile-links">
//             {navigationItems?.map((item) => (
//               <Link
//                 key={item?.path}
//                 to={item?.path}
//                 className={`primary-nav-mobile-link ${isActivePath(item?.path) ? 'active' : ''}`}
//                 aria-current={isActivePath(item?.path) ? 'page' : undefined}
//               >
//                 <span className="flex items-center gap-3">
//                   <Icon name={item?.icon} size={20} />
//                   <span className="flex flex-col">
//                     <span className="font-medium">{item?.label}</span>
//                     <span className="text-xs text-muted-foreground">{item?.description}</span>
//                   </span>
//                 </span>
//               </Link>
//             ))}
//           </div>
//         </div>
//       )}
//     </>
//   );
// };

// export default PrimaryNavigation;
