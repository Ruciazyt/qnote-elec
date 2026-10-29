import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker, type DayPickerProps } from 'react-day-picker'

import { cn } from '@/lib/utils'

export type CalendarProps = DayPickerProps

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'relative flex flex-col sm:flex-row gap-2',
        month: 'space-y-4',
        month_caption: 'flex justify-center pt-1 relative items-center',
        caption_label: 'text-sm font-medium',
        nav: 'pointer-events-none absolute inset-x-1 top-0 z-10 flex h-8 items-center justify-between gap-1',
        button_previous:
          'pointer-events-auto absolute left-0 top-0 h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100',
        button_next:
          'pointer-events-auto absolute right-0 top-0 h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100',
        month_grid: 'w-full border-collapse space-y-1',
        weekdays: 'flex',
        weekday: 'text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]',
        week: 'flex w-full mt-2',
        day: 'h-9 w-9 text-center text-sm p-0 relative focus-within:relative focus-within:z-20',
        day_button:
          'h-9 w-9 p-0 font-normal rounded-md hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        selected:
          'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
        today: 'bg-accent text-accent-foreground',
        outside: 'text-muted-foreground opacity-50',
        disabled: 'text-muted-foreground opacity-50',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...props }) =>
          orientation === 'left' ? (
            <ChevronLeft {...props} className="h-4 w-4" />
          ) : (
            <ChevronRight {...props} className="h-4 w-4" />
          ),
      }}
      {...props}
    />
  )
}

Calendar.displayName = 'Calendar'

export { Calendar }
