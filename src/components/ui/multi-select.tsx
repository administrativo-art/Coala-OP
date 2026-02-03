"use client"

import * as React from "react"
import { X, Check } from "lucide-react"
import { useVirtualizer } from '@tanstack/react-virtual'

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

type Option = {
  value: string
  label: string
}

interface MultiSelectProps {
  options: Option[]
  selected: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  className?: string
}

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Selecione...",
  className,
}: MultiSelectProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [open, setOpen] = React.useState(false)
  const [inputValue, setInputValue] = React.useState("")
  const [activeIndex, setActiveIndex] = React.useState(-1);

  const parentRef = React.useRef<HTMLDivElement>(null)

  const filteredOptions = React.useMemo(() => {
    if (!inputValue) return options
    const normalize = (str: string) => str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    const query = normalize(inputValue)
    return options.filter((option) => normalize(option.label).includes(query))
  }, [options, inputValue])

  const rowVirtualizer = useVirtualizer({
    count: filteredOptions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36, // Roughly h-9 + py-1.5
    overscan: 5,
  })

  const handleUnselect = (value: string) => {
    onChange(selected.filter((s) => s !== value))
  }

  const handleSelect = (value: string) => {
    setInputValue("")
    setActiveIndex(-1);
    if (selected.includes(value)) {
      handleUnselect(value)
    } else {
      onChange([...selected, value])
    }
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const input = inputRef.current
    if (input) {
      if (e.key === "Delete" || e.key === "Backspace") {
        if (input.value === "" && selected.length > 0) {
          handleUnselect(selected[selected.length - 1])
        }
      }
      if (e.key === "Escape") {
        input.blur()
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const newIndex = Math.min(activeIndex + 1, filteredOptions.length - 1);
        setActiveIndex(newIndex);
        rowVirtualizer.scrollToIndex(newIndex, { align: 'auto' });
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const newIndex = Math.max(activeIndex - 1, 0);
        setActiveIndex(newIndex);
        rowVirtualizer.scrollToIndex(newIndex, { align: 'auto' });
      }
      if (e.key === "Enter" && activeIndex !== -1) {
        e.preventDefault();
        const option = filteredOptions[activeIndex];
        if (option) {
            handleSelect(option.value);
        }
      }
    }
  }

  React.useEffect(() => {
    setActiveIndex(-1);
  }, [inputValue]);


  return (
    <div className={cn("relative", className)}>
      <div onKeyDown={handleKeyDown}>
        <div
          className="group border border-input px-3 py-2 text-sm ring-offset-background rounded-md focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
        >
          <div className="flex flex-wrap gap-1">
            {selected.map((value) => {
              const option = options.find((o) => o.value === value)
              return (
                <Badge key={value} variant="secondary" className="hover:bg-secondary/80">
                  {option?.label || value}
                  <button
                    className="ml-1 ring-offset-background rounded-full outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleUnselect(value)}
                  >
                    <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  </button>
                </Badge>
              )
            })}
            <input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onBlur={() => setTimeout(() => setOpen(false), 100)} // Delay blur to allow click
              onFocus={() => setOpen(true)}
              placeholder={selected.length === 0 ? placeholder : ""}
              className="ml-2 bg-transparent outline-none placeholder:text-muted-foreground flex-1 min-w-[120px]"
            />
          </div>
        </div>
        
        {open && (
            <div 
              className="absolute top-full z-50 w-full mt-2 bg-popover text-popover-foreground rounded-md border shadow-md outline-none animate-in fade-in-0 zoom-in-95"
              onMouseDown={(e) => e.preventDefault()}
            >
            <div ref={parentRef} className="max-h-[300px] overflow-auto p-1">
              {filteredOptions.length > 0 ? (
                <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                  {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                    const option = filteredOptions[virtualItem.index]
                    const isSelected = selected.includes(option.value)
                    return (
                      <div
                        key={option.value}
                        data-value={option.value}
                        onMouseDown={() => handleSelect(option.value)}
                        className={cn(
                          "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
                          "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                          activeIndex === virtualItem.index ? "bg-accent text-accent-foreground" : ""
                        )}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: `${virtualItem.size}px`,
                          transform: `translateY(${virtualItem.start}px)`,
                        }}
                      >
                          <div
                          className={cn(
                              "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                              isSelected
                              ? "bg-primary text-primary-foreground"
                              : "opacity-50 [&_svg]:invisible"
                          )}
                          >
                          <Check className={cn("h-4 w-4", !isSelected && "hidden")} />
                          </div>
                          {option.label}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="py-6 text-center text-sm">Nenhum insumo encontrado.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}