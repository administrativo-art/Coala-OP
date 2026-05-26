import Image from 'next/image';
import type { Employee, RhAccessCache } from '@/types/rh';
import { getStatusBadge } from '../lib/field-format';

type Props = {
  employee:   Employee;
  cache:      RhAccessCache;
  jobTitle?:  string;
  kioskName?: string;
};

export function EmployeeHeader({ employee, cache, jobTitle, kioskName }: Props) {
  const { label: statusLabel, color: statusColor } = getStatusBadge(employee.status);
  const initials = employee.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <div className="flex items-start gap-5 pb-6 border-b border-gray-100">
      <div className="relative shrink-0">
        {employee.photo_url ? (
          <div className="w-20 h-20 rounded-full overflow-hidden ring-2 ring-white shadow-md">
            <Image
              src={employee.photo_url}
              alt={employee.name}
              width={80}
              height={80}
              className="object-cover w-full h-full"
            />
          </div>
        ) : (
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-violet-400 to-violet-600 flex items-center justify-center ring-2 ring-white shadow-md">
            <span className="text-white text-xl font-semibold">{initials}</span>
          </div>
        )}
        <span
          className={`absolute -bottom-1 -right-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border border-white shadow-sm ${statusColor}`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <h1 className="text-xl font-semibold text-gray-900 truncate">{employee.name}</h1>

        {jobTitle && (
          <p className="text-sm text-gray-600 mt-0.5">{jobTitle}</p>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
          {kioskName && (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
              </svg>
              {kioskName}
            </span>
          )}
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
            </svg>
            ID {employee.bizneo_employee_id}
          </span>
        </div>
      </div>

      {cache.rh_role === 'admin' && (
        <div className="shrink-0">
          <span className="text-xs font-medium px-2 py-1 rounded bg-violet-50 text-violet-700 border border-violet-100">
            Admin
          </span>
        </div>
      )}
    </div>
  );
}
