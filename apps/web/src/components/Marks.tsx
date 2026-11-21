import { V } from "@/lib/v";

// The camera mark in both themes; CSS shows the right one (.only-light / .only-dark).
export function Marks({ className = "mark", alt = "" }: { className?: string; alt?: string }) {
  return (
    <>
      <img className={`${className} only-light`} src={`/logo-light.png?v=${V}`} alt={alt} decoding="sync" draggable={false} />
      <img className={`${className} only-dark`} src={`/logo-dark.png?v=${V}`} alt={alt} decoding="sync" draggable={false} />
    </>
  );
}
