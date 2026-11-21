type Fields = Record<string, unknown>;
const out = (level: string, msg: string, f?: Fields) => {
  if (process.env.LOG_SILENT && level !== 'error') return;
  console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...f }));
};
export const log = {
  info: (m: string, f?: Fields) => out('info', m, f),
  warn: (m: string, f?: Fields) => out('warn', m, f),
  error: (m: string, f?: Fields) => out('error', m, f),
};
