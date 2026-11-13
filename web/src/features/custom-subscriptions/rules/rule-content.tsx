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
import { nanoid } from 'nanoid'
import { useMemo } from 'react'
import type { RuleContent } from './types'
import '@/styles/subscription-rule-content.css'

export function RuleContentView(props: { content: RuleContent }) {
  const blocks = useMemo(() => props.content.blocks.map(block => ({ key: nanoid(), children: block.children.map(part => ({ ...part, key: nanoid() })) })), [props.content])
  return <div className='subscription-rule-content [overflow-wrap:anywhere] whitespace-pre-wrap'>{blocks.map(block => <p key={block.key}>{block.children.map(part => <span key={part.key} style={{ fontWeight: part.style?.fontWeight, color: part.style?.color, backgroundColor: part.style?.backgroundColor }}>{part.text}</span>)}</p>)}</div>
}
