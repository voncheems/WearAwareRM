import React from 'react';

export default function WearAwareLogo({ size = 32 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Shield body */}
      <path
        d="M32 4L8 16v16c0 14.4 10.24 27.84 24 32 13.76-4.16 24-17.6 24-32V16L32 4z"
        fill="url(#shieldGrad)"
        stroke="url(#strokeGrad)"
        strokeWidth="2"
      />
      {/* Inner shield highlight */}
      <path
        d="M32 10L14 19.5v12.5c0 11.2 7.68 21.6 18 24.8 10.32-3.2 18-13.6 18-24.8V19.5L32 10z"
        fill="url(#innerGrad)"
        opacity="0.35"
      />
      {/* Hard hat dome */}
      <path
        d="M22 34c0-6.627 4.477-12 10-12s10 5.373 10 12"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      {/* Hard hat brim */}
      <rect x="18" y="33" width="28" height="4" rx="2" fill="#fff" />
      {/* Checkmark */}
      <path
        d="M26 43l4 4 8-8"
        stroke="#6ee7a0"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Gradients */}
      <defs>
        <linearGradient id="shieldGrad" x1="8" y1="4" x2="56" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f97316" />
          <stop offset="1" stopColor="#ea580c" />
        </linearGradient>
        <linearGradient id="strokeGrad" x1="8" y1="4" x2="56" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fb923c" />
          <stop offset="1" stopColor="#c2410c" />
        </linearGradient>
        <linearGradient id="innerGrad" x1="14" y1="10" x2="50" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}