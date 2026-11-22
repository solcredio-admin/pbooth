"use client";
/** 256 random bits for the guest's QR link, made here so the QR works even if the network is down. */
export const newGalleryToken = () => {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
