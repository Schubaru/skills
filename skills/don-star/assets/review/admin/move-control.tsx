// Where a project is filed, as one control.
//
// A select rather than a menu: in a table the question is always the same and
// the answer is always one of a short list, so the native control is the one
// that already works with a keyboard, a screen reader and a phone.
//
// Moving a project CHANGES WHO CAN SEE IT, which is why it asks first —
// moveConfirmText() writes the sentence from the folder's own grants, so the
// folder page and the projects folder both say the same thing.

import { moveConfirmText, moveProject } from "../access";
import type { Folder } from "../access-rules";
import { orderedFolders, type AdminData } from "./data";

export function MoveControl({
  data,
  slug,
  label,
}: {
  data: AdminData;
  slug: string;
  /** What a screen reader hears: "Folder for __DS_PROJECT_NAME__". */
  label: string;
}) {
  const at = data.items.find((i) => i.projectSlug === slug)?.folderId ?? null;
  const folders = orderedFolders(data.folders);

  const pick = (raw: string) => {
    const folder: Folder | null = raw === "" ? null : (folders.find((f) => String(f.id) === raw) ?? null);
    if (raw !== "" && !folder) return;
    const ask = moveConfirmText(folder, data.folderGrants);
    if (ask && !window.confirm(ask)) return;
    void data.run(() => moveProject(slug, folder ? folder.id : null));
  };

  return (
    <select
      className="rv-folder-input rv-adm-select"
      aria-label={`Folder for ${label}`}
      value={at === null ? "" : String(at)}
      disabled={data.busy}
      onChange={(e) => pick(e.target.value)}
    >
      <option value="">No folder</option>
      {folders.map((f) => (
        <option key={f.id} value={String(f.id)}>
          {f.name}
        </option>
      ))}
    </select>
  );
}
