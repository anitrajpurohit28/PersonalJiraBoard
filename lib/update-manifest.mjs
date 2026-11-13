export function compareVersions(left, right) {
  if (![left, right].every(value => /^\d+\.\d+\.\d+$/.test(value))) throw new Error('Invalid application version.');
  const a = left.split('.').map(BigInt), b = right.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}
export function validateRepository(repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || repository.split('/').some(value => value === '.' || value === '..')) throw new Error('Invalid update repository.');
  return repository;
}
export function releaseUrl(repository, tag, name) {
  validateRepository(repository);
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || !/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error('Invalid release asset.');
  return `https://github.com/${repository}/releases/download/${tag}/${name}`;
}
export function validateManifest(value, repository, tag) {
  if (!value || value.schema !== 1 || `v${value.version}` !== tag || !/^[a-f0-9]{40}$/.test(value.commit || '')) throw new Error('The release manifest is invalid.');
  compareVersions(value.version, value.version);
  for (const platform of ['darwin-arm64','darwin-x64','win32-x64','win32-arm64']) {
    const asset = value.platforms?.[platform];
    if (!asset || !/^[a-f0-9]{64}$/.test(asset.sha256 || '') || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > 1500000000 || asset.url !== releaseUrl(repository, tag, asset.name)) throw new Error(`Invalid release package for ${platform}.`);
  }
  return value;
}
