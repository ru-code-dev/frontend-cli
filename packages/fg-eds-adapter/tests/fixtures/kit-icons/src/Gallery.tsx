import { Home } from "lucide-react";

import blob from "./assets/blob.svg";
import disco from "./assets/disco.svg";

export const Gallery = () => (
  <div className="gallery">
    <Home />
    <img src={blob} alt="blob" />
    <img src={disco} alt="disco" />
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M11 4.5L5.25 4.5L5.25 15.49L11 15.49C14.03 15.49 16.5 13.03 16.5 9.99C16.5 6.96 14.03 4.5 11 4.5ZM6.75 6L6.75 13.99L13.84 7.18C13.11 6.45 12.11 6 11 6L6.75 6Z"
        fill="currentColor"
      />
    </svg>
    <svg width="12" height="12" viewBox="0 0 12 12">
      <rect x="1" y="1" width="10" height="10" />
    </svg>
  </div>
);
