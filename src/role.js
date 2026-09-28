// The posting title identifies a target specialty. It never becomes an
// employer-issued title unless a matching Intern title already exists in the
// verified profile and the user approves that exact variant.
export function targetRoleFor(jobTitle) {
  const title = String(jobTitle ?? '').toLowerCase();
  if (/\bdev[\s-]?ops\b/.test(title)) return 'DevOps Engineer';
  if (/\bback[\s-]?end\b/.test(title)) return 'Backend Engineer';
  return null;
}
