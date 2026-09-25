import { useEffect, useState } from "react";
import LightTable from "./LightTable";
import { loadArchive } from "./archive";
import type { ArchiveShoot } from "./archive";

function Loading() {
  return <main className="ns-status"><span>NOLLE STUDIOS / PHOTOGRAPHY</span><p>Opening the light table…</p></main>;
}

function Empty() {
  return <main className="ns-status"><span>NOLLE STUDIOS / PHOTOGRAPHY</span><h1>The table is being prepared.</h1><p>No photographs are published yet. Please check back soon.</p></main>;
}

export default function Site() {
  const [shoots, setShoots] = useState<ArchiveShoot[] | null>(null);
  const initialShoot = new URLSearchParams(window.location.search).get("shoot");

  useEffect(() => {
    let active = true;
    loadArchive().then(result => { if (active) setShoots(result); });
    return () => { active = false; };
  }, []);

  if (shoots === null) return <Loading />;
  if (!shoots.length) return <Empty />;
  return <LightTable shoots={shoots} initialShoot={initialShoot} />;
}
