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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import type { RuleContent, RuleStyle } from './types'

export function RuleContentEditor(props: {
  value: RuleContent
  onChange: (content: RuleContent) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [keys, setKeys] = useState(() =>
    props.value.blocks.map((block) => ({
      key: nanoid(),
      parts: block.children.map(() => nanoid()),
    }))
  )
  const changePart = (
    blockIndex: number,
    partIndex: number,
    update: { text?: string; style?: RuleStyle }
  ) => {
    props.onChange({
      blocks: props.value.blocks.map((block, index) =>
        index === blockIndex
          ? {
              ...block,
              children: block.children.map((part, child) =>
                child === partIndex ? { ...part, ...update } : part
              ),
            }
          : block
      ),
    })
  }
  return (
    <div className='space-y-4'>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Split a paragraph into text fragments to style individual phrases. Colors use six-digit HEX values; clear a color to inherit the theme.'
        )}
      </p>
      {props.value.blocks.map((block, blockIndex) => (
        <fieldset
          key={keys[blockIndex].key}
          disabled={props.disabled}
          className='border-border min-w-0 space-y-3 rounded-lg border p-3'
        >
          <legend className='px-1 text-sm font-medium'>
            {t('Paragraph {{number}}', { number: blockIndex + 1 })}
          </legend>
          {block.children.map((part, partIndex) => (
            <div
              key={keys[blockIndex].parts[partIndex]}
              className='bg-muted/30 min-w-0 space-y-2 rounded-md p-3'
            >
              <Label htmlFor={`rule-text-${blockIndex}-${partIndex}`}>
                {t('Text fragment {{number}}', { number: partIndex + 1 })}
              </Label>
              <Textarea
                id={`rule-text-${blockIndex}-${partIndex}`}
                value={part.text}
                onChange={(event) =>
                  changePart(blockIndex, partIndex, {
                    text: event.target.value,
                  })
                }
              />
              <div className='grid gap-3 sm:grid-cols-2'>
                {(['color', 'backgroundColor'] as const).map((property) => (
                  <div key={property} className='space-y-1'>
                    <Label
                      htmlFor={`rule-${property}-${blockIndex}-${partIndex}`}
                    >
                      {t(
                        property === 'color' ? 'Text color' : 'Highlight color'
                      )}
                    </Label>
                    <Input
                      id={`rule-${property}-${blockIndex}-${partIndex}`}
                      placeholder='#0052d9'
                      aria-invalid={
                        !!part.style?.[property] &&
                        !/^#[0-9a-fA-F]{6}$/.test(part.style[property] ?? '')
                      }
                      aria-describedby={`rule-${property}-error-${blockIndex}-${partIndex}`}
                      value={part.style?.[property] ?? ''}
                      onChange={(event) => {
                        const style = { ...part.style }
                        if (event.target.value) {
                          style[property] = event.target.value
                        } else delete style[property]
                        changePart(blockIndex, partIndex, { style })
                      }}
                    />
                    {!!part.style?.[property] &&
                      !/^#[0-9a-fA-F]{6}$/.test(part.style[property] ?? '') && (
                        <p
                          id={`rule-${property}-error-${blockIndex}-${partIndex}`}
                          className='text-destructive text-xs'
                        >
                          {t('Use a six-digit HEX color')}
                        </p>
                      )}
                  </div>
                ))}
              </div>
              <div className='flex flex-wrap items-center gap-3'>
                <Switch
                  id={`rule-bold-${blockIndex}-${partIndex}`}
                  checked={part.style?.fontWeight === 700}
                  onCheckedChange={(checked) =>
                    changePart(blockIndex, partIndex, {
                      style: { ...part.style, fontWeight: checked ? 700 : 400 },
                    })
                  }
                />
                <Label htmlFor={`rule-bold-${blockIndex}-${partIndex}`}>
                  {t('Bold')}
                </Label>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() =>
                    changePart(blockIndex, partIndex, { style: {} })
                  }
                >
                  {t('Reset style')}
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  disabled={block.children.length === 1}
                  onClick={() => {
                    setKeys((previous) =>
                      previous.map((item, index) =>
                        index === blockIndex
                          ? {
                              ...item,
                              parts: item.parts.filter(
                                (_, child) => child !== partIndex
                              ),
                            }
                          : item
                      )
                    )
                    props.onChange({
                      blocks: props.value.blocks.map((item, index) =>
                        index === blockIndex
                          ? {
                              ...item,
                              children: item.children.filter(
                                (_, child) => child !== partIndex
                              ),
                            }
                          : item
                      ),
                    })
                  }}
                >
                  {t('Remove fragment')}
                </Button>
              </div>
            </div>
          ))}
          <div className='flex flex-wrap gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={block.children.length >= 50}
              onClick={() => {
                setKeys((previous) =>
                  previous.map((item, index) =>
                    index === blockIndex
                      ? { ...item, parts: [...item.parts, nanoid()] }
                      : item
                  )
                )
                props.onChange({
                  blocks: props.value.blocks.map((item, index) =>
                    index === blockIndex
                      ? { ...item, children: [...item.children, { text: '' }] }
                      : item
                  ),
                })
              }}
            >
              {t('Add fragment')}
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              disabled={props.value.blocks.length === 1}
              onClick={() => {
                setKeys((previous) =>
                  previous.filter((_, index) => index !== blockIndex)
                )
                props.onChange({
                  blocks: props.value.blocks.filter(
                    (_, index) => index !== blockIndex
                  ),
                })
              }}
            >
              {t('Remove paragraph')}
            </Button>
          </div>
        </fieldset>
      ))}
      <Button
        type='button'
        variant='outline'
        disabled={props.disabled || props.value.blocks.length >= 20}
        onClick={() => {
          setKeys((previous) => [
            ...previous,
            { key: nanoid(), parts: [nanoid()] },
          ])
          props.onChange({
            blocks: [
              ...props.value.blocks,
              { type: 'paragraph', children: [{ text: '' }] },
            ],
          })
        }}
      >
        {t('Add paragraph')}
      </Button>
    </div>
  )
}
