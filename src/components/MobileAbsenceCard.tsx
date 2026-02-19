import { ReactNode } from 'react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Calendar, Pencil, Trash2, Check, X, Clock, Plane, Ban, Thermometer, Loader2, ChevronDown, Circle, GraduationCap, CircleDot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { Database } from '@/integrations/supabase/types';

type AbsenceType = Database['public']['Enums']['absence_type'];

export interface MobileAbsenceCardProps {
  type: AbsenceType;
  startDate: string;
  endDate: string;
  workDays?: number | null;
  calculatingDays?: boolean;
  status?: 'pending' | 'approved' | 'rejected' | 'active' | 'past' | 'planned';
  notes?: string | null;
  rejectionReason?: string | null;
  employeeName?: string;
  employeeNumber?: string | null;
  certificateStatus?: string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  isHalfDay?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onCertificateStatusChange?: (status: 'received' | 'not_required' | 'pending') => void;
  isProcessing?: boolean;
  children?: ReactNode;
}

export default function MobileAbsenceCard({
  type,
  startDate,
  endDate,
  workDays,
  calculatingDays,
  status,
  notes,
  rejectionReason,
  employeeName,
  employeeNumber,
  certificateStatus,
  approvedAt,
  approvedBy,
  isHalfDay,
  onEdit,
  onDelete,
  onApprove,
  onReject,
  onCertificateStatusChange,
  isProcessing,
  children,
}: MobileAbsenceCardProps) {
  const getTypeBadge = () => {
    switch (type) {
      case 'vacation':
        return (
          <Badge variant="secondary" className="gap-1">
            <Plane className="h-3 w-3" />
            Bezahlter Urlaub
          </Badge>
        );
      case 'unpaid_leave':
        return (
          <Badge variant="outline" className="gap-1">
            <Ban className="h-3 w-3" />
            Unbezahlter Urlaub
          </Badge>
        );
      case 'comp_time':
        return (
          <Badge className="bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-900 dark:text-sky-200 gap-1">
            <Clock className="h-3 w-3" />
            Überstundenfrei
          </Badge>
        );
      case 'sick':
        return (
          <Badge variant="destructive" className="gap-1">
            <Thermometer className="h-3 w-3" />
            Krankmeldung
          </Badge>
        );
      case 'vocational_school':
        return (
          <Badge className="bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900 dark:text-purple-200 gap-1">
            <GraduationCap className="h-3 w-3" />
            Berufsschule
          </Badge>
        );
      case 'other':
        return (
          <Badge variant="outline" className="gap-1">
            <CircleDot className="h-3 w-3" />
            Sonstiges
          </Badge>
        );
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900 dark:text-yellow-200">⏳ Ausstehend</Badge>;
      case 'approved':
        return <Badge className="bg-green-100 text-green-800 border-green-300 dark:bg-green-900 dark:text-green-200">✓ Genehmigt</Badge>;
      case 'rejected':
        return <Badge className="bg-red-100 text-red-800 border-red-300 dark:bg-red-900 dark:text-red-200">✗ Abgelehnt</Badge>;
      case 'active':
        return <Badge variant="destructive">Aktiv</Badge>;
      case 'past':
        return <Badge variant="secondary">Vergangen</Badge>;
      case 'planned':
        return <Badge variant="outline">Geplant</Badge>;
      default:
        return null;
    }
  };

  const getCertificateStatusBadge = () => {
    switch (certificateStatus) {
      case 'received':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"><Check className="h-3 w-3 mr-1" /> Attest erhalten</Badge>;
      case 'not_required':
        return <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"><Circle className="h-3 w-3 mr-1" /> Nicht nötig</Badge>;
      case 'pending':
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"><X className="h-3 w-3 mr-1" /> Attest ausstehend</Badge>;
      default:
        return null;
    }
  };

  const hasActions = onEdit || onDelete || onApprove || onReject || onCertificateStatusChange;
  const hasDetails = notes || rejectionReason || approvedAt || (type === 'sick' && certificateStatus);

  return (
    <Card className="p-4">
      {/* Header: Employee + Type Badge */}
      <div className="flex flex-col gap-2 mb-3">
        {employeeName && (
          <div>
            <div className="font-medium text-base">{employeeName}</div>
            {employeeNumber && (
              <div className="text-xs text-muted-foreground">Nr. {employeeNumber}</div>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {getTypeBadge()}
          {isHalfDay && (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">
              ½ Tag
            </Badge>
          )}
          {getStatusBadge()}
        </div>
      </div>

      {/* Date + Days */}
      <div className="flex items-center gap-2 text-sm mb-3">
        <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="font-medium">
          {format(new Date(startDate), 'dd. MMM yyyy', { locale: de })}
          {startDate !== endDate && (
            <> – {format(new Date(endDate), 'dd. MMM yyyy', { locale: de })}</>
          )}
        </span>
      </div>

      {/* Work Days */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
        <Clock className="h-4 w-4 flex-shrink-0" />
        {calculatingDays ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <span>
            {workDays?.toLocaleString('de-DE') ?? '-'} {workDays === 1 ? 'Arbeitstag' : 'Arbeitstage'}
            {isHalfDay && ' (halber Tag)'}
          </span>
        )}
      </div>

      {/* Certificate Status for Sick Leaves */}
      {type === 'sick' && certificateStatus && (
        <div className="mb-3">
          {getCertificateStatusBadge()}
        </div>
      )}

      {/* Details Collapsible */}
      {hasDetails && (
        <Collapsible className="mb-3">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between px-2 h-9">
              <span className="text-sm text-muted-foreground">Details anzeigen</span>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 space-y-2">
            {notes && (
              <div className="text-sm bg-muted/50 rounded-md p-3">
                <span className="font-medium">Notizen:</span> {notes}
              </div>
            )}
            {rejectionReason && (
              <div className="text-sm bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200 rounded-md p-3">
                <span className="font-medium">Ablehnungsgrund:</span> {rejectionReason}
              </div>
            )}
            {approvedAt && (
              <div className="text-xs text-muted-foreground">
                {status === 'approved' ? 'Genehmigt' : 'Bearbeitet'} am {format(new Date(approvedAt), 'dd. MMM yyyy', { locale: de })}
                {approvedBy && ` von ${approvedBy}`}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Custom Children */}
      {children}

      {/* Actions */}
      {hasActions && (
        <div className="flex flex-col gap-2 pt-2 border-t">
          {/* Approve/Reject Buttons for Pending Requests */}
          {status === 'pending' && (onApprove || onReject) && (
            <div className="flex gap-2">
              {onApprove && (
                <Button 
                  onClick={onApprove} 
                  disabled={isProcessing}
                  className="flex-1 min-h-[44px] gap-2"
                >
                  <Check className="h-4 w-4" />
                  Genehmigen
                </Button>
              )}
              {onReject && (
                <Button 
                  variant="destructive"
                  onClick={onReject} 
                  disabled={isProcessing}
                  className="flex-1 min-h-[44px] gap-2"
                >
                  <X className="h-4 w-4" />
                  Ablehnen
                </Button>
              )}
            </div>
          )}

          {/* Certificate Status Buttons for Sick Leaves - Optimized Grid Layout */}
          {type === 'sick' && onCertificateStatusChange && (
            <div className="grid grid-cols-3 gap-1">
              <Button
                size="sm"
                variant={certificateStatus === 'received' ? 'default' : 'outline'}
                onClick={() => onCertificateStatusChange('received')}
                disabled={isProcessing}
                className="min-h-[40px] text-xs px-1"
              >
                <Check className="h-3 w-3 mr-0.5 flex-shrink-0" />
                <span className="truncate">Erhalten</span>
              </Button>
              <Button
                size="sm"
                variant={certificateStatus === 'not_required' ? 'default' : 'outline'}
                onClick={() => onCertificateStatusChange('not_required')}
                disabled={isProcessing}
                className="min-h-[40px] text-xs px-1"
              >
                <Circle className="h-3 w-3 mr-0.5 flex-shrink-0" />
                <span className="truncate">Nicht nötig</span>
              </Button>
              <Button
                size="sm"
                variant={certificateStatus === 'pending' ? 'default' : 'outline'}
                onClick={() => onCertificateStatusChange('pending')}
                disabled={isProcessing}
                className="min-h-[40px] text-xs px-1"
              >
                <X className="h-3 w-3 mr-0.5 flex-shrink-0" />
                <span className="truncate">Ausstehend</span>
              </Button>
            </div>
          )}

          {/* Edit/Delete Buttons */}
          {(onEdit || onDelete) && (
            <div className="flex gap-2">
              {onEdit && (
                <Button 
                  variant="outline"
                  onClick={onEdit} 
                  disabled={isProcessing}
                  className="flex-1 min-h-[44px] gap-2"
                >
                  <Pencil className="h-4 w-4" />
                  Bearbeiten
                </Button>
              )}
              {onDelete && (
                <Button 
                  variant="outline"
                  onClick={onDelete} 
                  disabled={isProcessing}
                  className={cn(
                    "min-h-[44px] gap-2 text-destructive hover:text-destructive",
                    !onEdit && "flex-1"
                  )}
                >
                  <Trash2 className="h-4 w-4" />
                  {!onEdit && 'Löschen'}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
