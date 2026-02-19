import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import { useState } from 'react';

interface MobileDatePickerProps {
  label: string;
  date: Date | undefined;
  onSelect: (date: Date | undefined) => void;
  disabled?: (date: Date) => boolean;
  placeholder?: string;
}

const MobileDatePicker = ({ 
  label, 
  date, 
  onSelect, 
  disabled,
  placeholder = 'Datum wählen' 
}: MobileDatePickerProps) => {
  const [open, setOpen] = useState(false);

  const handleSelect = (selectedDate: Date | undefined) => {
    onSelect(selectedDate);
    if (selectedDate) {
      setOpen(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'w-full justify-start text-left font-normal h-12',
            !date && 'text-muted-foreground'
          )}
        >
          <CalendarIcon className="mr-2 h-5 w-5" />
          {date ? format(date, 'PPP', { locale: de }) : placeholder}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{label}</DrawerTitle>
        </DrawerHeader>
        <div className="p-4 pb-8 flex justify-center">
          <Calendar
            mode="single"
            selected={date}
            onSelect={handleSelect}
            disabled={disabled}
            initialFocus
            className="pointer-events-auto"
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default MobileDatePicker;
