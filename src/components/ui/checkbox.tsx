import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return <CheckboxPrimitive.Root data-slot="checkbox" className={cn('checkbox', className)} {...props}><CheckboxPrimitive.Indicator className="checkbox-indicator">{props.checked === 'indeterminate' ? <Minus size={11} strokeWidth={3} /> : <Check size={11} strokeWidth={3} />}</CheckboxPrimitive.Indicator></CheckboxPrimitive.Root>
}
export { Checkbox }
