import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { UserRound, Mail, Phone, ShieldCheck, Building2, Save } from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { ErrorAlert } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';

const schema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  phone: z
    .string()
    .trim()
    .regex(/^[+0-9()\-\s]{6,20}$/, 'Enter a valid phone number')
    .optional()
    .or(z.literal('')),
  designation: z.string().max(80).optional(),
  territory: z.string().max(80).optional(),
});

export default function Profile() {
  const { user, company, loadCompanyContext } = useAuth();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: user?.name || '',
      phone: user?.phone || '',
      designation: user?.title || '',
      territory: user?.territory || '',
    },
  });

  useEffect(() => {
    reset({
      name: user?.name || '',
      phone: user?.phone || '',
      designation: user?.title || '',
      territory: user?.territory || '',
    });
  }, [user, reset]);

  const onSubmit = async (values) => {
    try {
      await api.patch('/v1/auth/profile', values);
      toast.success('Profile updated');
      await loadCompanyContext();
    } catch (err) {
      const e = apiError(err);
      if (e.errors?.length) {
        Object.entries(toFieldErrors(e.errors)).forEach(([f, m]) => setError(f, { message: m }));
      }
      toast.error(e.message);
    }
  };

  const role = user?.role || '—';

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="My profile"
        description="Your personal details inside this workspace."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Profile' }]}
      />

      <div className="grid gap-5 md:grid-cols-3">
        {/* ---- Identity card ---- */}
        <Card className="md:col-span-1">
          <CardContent className="flex flex-col items-center p-6 text-center">
            <Avatar name={user?.name} src={user?.avatar} size="xl" />
            <h2 className="mt-4 text-base font-semibold">{user?.name}</h2>
            <p className="text-sm text-muted-foreground">{user?.email || user?.phone}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              <Badge tone="info">{role.replace(/_/g, ' ')}</Badge>
              {user?.title && <Badge tone="muted">{user.title}</Badge>}
            </div>

            <div className="mt-6 w-full space-y-3 border-t pt-4 text-left text-sm">
              <div className="flex items-center gap-2.5">
                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{company?.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {company?.code} · {company?.status}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  Signed in with a 15-minute access token + rotating refresh session
                </span>
              </div>
            </div>

            <div className="mt-5 flex w-full flex-col gap-2">
              <Button variant="outline" onClick={() => navigate('/app/change-password')}>
                Change password
              </Button>
              <Button variant="outline" onClick={() => navigate('/app/sessions')}>
                Active sessions
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ---- Edit form ---- */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-muted-foreground" /> Edit details
            </CardTitle>
            <CardDescription>
              Only your name, phone and territory can be edited here. Roles and email are managed
              by your company administrator.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label required>Name</Label>
                  <Input error={errors.name?.message} {...register('name')} />
                  {errors.name && <p className="text-xs font-medium text-destructive">{errors.name.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input placeholder="+91XXXXXXXXXX" error={errors.phone?.message} {...register('phone')} />
                  {errors.phone && (
                    <p className="text-xs font-medium text-destructive">{errors.phone.message}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Designation</Label>
                  <Input placeholder="Sales Executive" {...register('designation')} />
                </div>
                <div className="space-y-1.5">
                  <Label>Territory / beat</Label>
                  <Input placeholder="Pune East" {...register('territory')} />
                </div>
              </div>

              <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> {user?.email || 'No email'} ·{' '}
                  <Phone className="h-3.5 w-3.5" /> {user?.phone || 'No phone'}
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => reset()}
                  disabled={!isDirty || isSubmitting}
                >
                  Reset
                </Button>
                <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
                  <Save className="h-4 w-4" /> Save changes
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
