import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import type { LoginInput } from '@mirthless/core-models';
import { api } from '../api/client.js';
import { useAuthStore } from '../stores/auth.store.js';

/** Shape of the login API success response data */
interface LoginResponseData {
  readonly accessToken: string;
  readonly user: {
    readonly id: string;
    readonly username: string;
    readonly email: string;
    readonly role: string;
    readonly permissions: ReadonlyArray<string>;
  };
}

export function LoginPage(): ReactNode {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    defaultValues: {
      username: '',
      password: '',
    },
  });

  const onSubmit = async (data: LoginInput): Promise<void> => {
    setErrorMessage(null);

    const result = await api.post<LoginResponseData>('/auth/login', data);

    if (!result.success) {
      setErrorMessage(result.error.message);
      return;
    }

    setAuth(result.data.user, result.data.accessToken);
    navigate('/');
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: 'background.default',
      }}
    >
      <Paper
        sx={{
          p: 4,
          width: '100%',
          maxWidth: 420,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}
      >
        <Box sx={{ textAlign: 'center' }}>
          <Typography
            variant="h4"
            component="h1"
            sx={{ fontWeight: 700, color: 'primary.main', mb: 0.5 }}
          >
            Mirthless
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Healthcare Integration Engine
          </Typography>
        </Box>

        {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}

        <Box
          component="form"
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <TextField
            label="Username"
            autoComplete="username"
            autoFocus
            fullWidth
            error={Boolean(errors.username)}
            helperText={errors.username?.message ?? (errors.username ? 'Username is required' : undefined)}
            {...register('username', { required: 'Username is required' })}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            fullWidth
            error={Boolean(errors.password)}
            helperText={
              errors.password?.message ??
              (errors.password ? 'Password must be at least 8 characters' : undefined)
            }
            {...register('password', {
              required: 'Password is required',
              minLength: { value: 8, message: 'Password must be at least 8 characters' },
            })}
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            fullWidth
            disabled={isSubmitting}
            sx={{ mt: 1 }}
          >
            {isSubmitting ? <CircularProgress size={24} color="inherit" /> : 'Sign In'}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
