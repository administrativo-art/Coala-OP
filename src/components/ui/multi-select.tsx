"use client"

import * as React from "react"
import { X } from "lucide-react"
import { Command as CommandPrimitive } from "cmdk"
import { Badge } from "@/components/ui/badge"
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import { cn } from "@/lib/utils"

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

  // Filtragem Manual (para evitar travamento)
  const filteredOptions = React.useMemo(() => {
    if (!inputValue) return options
    const normalize = (str: string) => str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    const query = normalize(inputValue)
    return options.filter((option) => normalize(option.label).includes(query))
  }, [options, inputValue])

  const handleUnselect = (value: string) => {
    onChange(selected.filter((s) => s !== value))
  }

  const handleSelect = (value: string) => {
    setInputValue("")
    if (selected.includes(value)) {
      handleUnselect(value)
    } else {
      onChange([...selected, value])
    }
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
    }
  }

  return (
    <div className={cn("relative overflow-visible", className)}>
      <Command 
        onKeyDown={handleKeyDown} 
        className="overflow-visible bg-transparent" 
        shouldFilter={false} // IMPORTANTE: Desativa filtro nativo
      >
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
                    onMouseDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    onClick={() => handleUnselect(value)}
                  >
                    <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  </button>
                </Badge>
              )
            })}
            <CommandPrimitive.Input
              ref={inputRef}
              value={inputValue}
              onValueChange={setInputValue}
              onBlur={() => setOpen(false)}
              onFocus={() => setOpen(true)}
              placeholder={selected.length === 0 ? placeholder : ""}
              className="ml-2 bg-transparent outline-none placeholder:text-muted-foreground flex-1 min-w-[120px]"
            />
          </div>
        </div>
        
        {/* Dropdown Flutuante */}
        {open && filteredOptions.length > 0 && (
            <div 
              className="absolute top-full z-50 w-full mt-2 bg-popover text-popover-foreground rounded-md border shadow-md outline-none animate-in fade-in-0 zoom-in-95"
              onMouseDown={(e) => {
                e.preventDefault(); // Impede o input de perder foco (blur)
              }}
            >
            <CommandList className="max-h-[300px] overflow-auto"> 
                {filteredOptions.map((option) => {
                    const isSelected = selected.includes(option.value)
                    return (
                    <CommandItem
                        key={option.value}
                        value={option.label} 
                        onSelect={() => handleSelect(option.value)}
                        className="cursor-pointer"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
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
                        <X className={cn("h-4 w-4", !isSelected && "hidden")} />
                        </div>
                        {option.label}
                    </CommandItem>
                    )
                })}
            </CommandList>
          </div>
        )}
      </Command>
    </div>
  )
}