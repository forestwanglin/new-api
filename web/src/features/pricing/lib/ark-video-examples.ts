/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
export function buildArkVideoSample(
  lang: 'curl' | 'python' | 'typescript' | 'javascript',
  ctx: {
    baseUrl: string
    endpointPath: string
    apiKeyEnv: string
    modelName: string
  }
): string {
  const url = `${ctx.baseUrl}${ctx.endpointPath}`
  const body = JSON.stringify(
    {
      model: ctx.modelName,
      prompt: 'A white ceramic cup on a wooden table, gentle camera movement.',
      seconds: '4',
      metadata: { resolution: '720p', ratio: '16:9', generate_audio: false },
    },
    null,
    2
  )
  if (lang === 'curl') {
    return [
      `curl '${url}' \\`,
      `  -H "Authorization: Bearer $${ctx.apiKeyEnv}" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '${body}'`,
    ].join('\n')
  }
  if (lang === 'python') {
    return [
      'import os, json, requests',
      `body = json.loads(r"""${body}""")`,
      `response = requests.post('${url}',`,
      `    headers={'Authorization': 'Bearer ' + os.environ['${ctx.apiKeyEnv}']},`,
      '    json=body, timeout=60)',
      'response.raise_for_status()',
      'print(response.json())',
    ].join('\n')
  }
  return [
    `const body = ${body};`,
    `const response = await fetch('${url}', {`,
    `  method: 'POST',`,
    `  headers: { Authorization: 'Bearer ' + process.env.${ctx.apiKeyEnv}, 'Content-Type': 'application/json' },`,
    '  body: JSON.stringify(body)',
    '});',
    'if (!response.ok) throw new Error(await response.text());',
    'console.log(await response.json());',
  ].join('\n')
}
