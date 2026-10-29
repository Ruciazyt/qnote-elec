import { useEffect, useRef, useState } from 'react'
import { format, isValid, parseISO } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { randomHex } from '@/utils/randomId'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CalendarIcon, ImagePlus, X } from 'lucide-react'
import type { Todo, TodoPriority, TodoAttachment } from './types'

interface TodoEditDialogProps {
  open: boolean
  todo?: Todo | null
  initialTitle?: string
  initialNotes?: string
  initialAttachments?: TodoAttachment[]
  onClose: () => void
  onSave: (input: {
    title: string
    notes?: string
    priority: TodoPriority
    due_date: string | null
    attachments?: TodoAttachment[]
  }) => Promise<void>
}

export function TodoEditDialog({
  open,
  todo,
  initialTitle,
  initialNotes,
  initialAttachments,
  onClose,
  onSave,
}: TodoEditDialogProps) {
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [priority, setPriority] = useState<TodoPriority>('medium')
  const [dueDate, setDueDate] = useState('')
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => new Date())
  const [attachments, setAttachments] = useState<TodoAttachment[]>([])
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isEdit = !!todo

  useEffect(() => {
    if (!open) return
    setDatePickerOpen(false)
    if (todo) {
      setTitle(todo.title)
      setNotes(todo.notes ?? '')
      setPriority(todo.priority)
      const nextDueDate = todo.due_date ? todo.due_date.slice(0, 10) : ''
      const parsedDueDate = nextDueDate ? parseISO(nextDueDate) : undefined
      setDueDate(nextDueDate)
      setCalendarMonth(parsedDueDate && isValid(parsedDueDate) ? parsedDueDate : new Date())
      setAttachments(todo.attachments ?? [])
    } else {
      setTitle(initialTitle ?? '')
      setNotes(initialNotes ?? '')
      setPriority('medium')
      setDueDate('')
      setCalendarMonth(new Date())
      setAttachments(initialAttachments ?? [])
    }
  }, [open, todo, initialTitle, initialNotes, initialAttachments])

  const parsedDueDate = dueDate ? parseISO(dueDate) : undefined
  const selectedDueDate = parsedDueDate && isValid(parsedDueDate) ? parsedDueDate : undefined

  const handleAddFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const additions: TodoAttachment[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (!file.type.startsWith('image/')) continue
      try {
        const dataUrl = await readFileAsDataUrl(file)
        additions.push({
          id: generateAttachmentId(),
          type: 'image',
          dataUrl,
          name: file.name,
        })
      } catch (err) {
        console.error('读取图片失败', err)
      }
    }
    if (additions.length > 0) {
      setAttachments((prev) => [...prev, ...additions])
    }
  }

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const handleSave = async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      await onSave({
        title: title.trim(),
        notes: notes.trim() || undefined,
        priority,
        due_date: dueDate || null,
        attachments: attachments.length > 0 ? attachments : undefined,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑 Todo' : '新建 Todo'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? '修改任务内容，完成后点击保存。'
              : '记录一个待办，可设优先级、截止日期，并可附带图片。'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="todo-title">标题</Label>
            <Input
              id="todo-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入 Todo 标题"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="todo-notes">备注（可选）</Label>
            <Textarea
              id="todo-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="补充说明..."
              className="min-h-[72px]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="todo-priority">优先级</Label>
              <Select
                value={priority}
                onValueChange={(value) => setPriority(value as TodoPriority)}
              >
                <SelectTrigger id="todo-priority">
                  <SelectValue placeholder="选择优先级" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">高</SelectItem>
                  <SelectItem value="medium">中</SelectItem>
                  <SelectItem value="low">低</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="todo-due-date">截止日期</Label>
              <Popover
                open={datePickerOpen}
                onOpenChange={(nextOpen) => {
                  setDatePickerOpen(nextOpen)
                  if (nextOpen) {
                    setCalendarMonth(selectedDueDate ?? new Date())
                  }
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    id="todo-due-date"
                    type="button"
                    variant="outline"
                    className={`h-9 w-full justify-start text-left font-normal ${
                      !selectedDueDate ? 'text-muted-foreground' : ''
                    }`}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {selectedDueDate ? (
                      format(selectedDueDate, 'yyyy年MM月dd日', { locale: zhCN })
                    ) : (
                      <span>选择日期</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={selectedDueDate}
                    onSelect={(date) => {
                      setDueDate(date ? format(date, 'yyyy-MM-dd') : '')
                      if (date) setDatePickerOpen(false)
                    }}
                    month={calendarMonth}
                    onMonthChange={setCalendarMonth}
                    autoFocus
                  />
                  {selectedDueDate && (
                    <div className="border-t p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          setDueDate('')
                          setDatePickerOpen(false)
                        }}
                      >
                        清除日期
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* 附件区 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label>
                附件
                {attachments.length > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground/70 font-normal">
                    {attachments.length} 张
                  </span>
                )}
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="h-7 px-2 text-xs btn-hover"
              >
                <ImagePlus className="h-3.5 w-3.5 mr-1" />
                添加图片
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleAddFiles(e.target.files)
                  // 清空 value 以便用户能再次选择同一文件
                  e.target.value = ''
                }}
              />
            </div>
            {attachments.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 p-2 rounded-md border border-dashed border-border/70 bg-muted/20 max-h-32 overflow-y-auto">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="group/att relative h-14 w-14 rounded-md overflow-hidden border border-border/70 bg-card"
                    title={att.name || '附件'}
                  >
                    <img
                      src={att.dataUrl}
                      alt={att.name || '附件'}
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveAttachment(att.id)}
                      className="absolute right-0 top-0 h-5 w-5 rounded-none bg-black/60 p-0 text-white opacity-0 transition-opacity hover:bg-destructive hover:text-white group-hover/att:opacity-100"
                      aria-label="移除附件"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border/60 bg-muted/20 px-3 py-3 text-center text-xs text-muted-foreground/70">
                支持添加图片作为附件（可多选）
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving} className="btn-hover">
            取消
          </Button>
          <Button onClick={handleSave} disabled={!title.trim() || saving} className="btn-hover">
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 生成附件唯一 id */
function generateAttachmentId(): string {
  return `att_${Date.now()}_${randomHex(6)}`
}

/** File → base64 data URL */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
