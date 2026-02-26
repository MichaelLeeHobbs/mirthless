import { createTheme, type ThemeOptions } from '@mui/material/styles';

const sharedOptions: ThemeOptions = {
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    button: {
      textTransform: 'none' as const,
    },
  },
  components: {
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
    },
    MuiPaper: {
      defaultProps: {
        elevation: 0,
      },
    },
  },
};

/** Dark theme — primary mode for healthcare monitoring dashboards */
export const darkTheme = createTheme({
  ...sharedOptions,
  palette: {
    mode: 'dark',
    primary: {
      main: '#4fc3f7',
    },
    secondary: {
      main: '#81c784',
    },
    background: {
      default: '#0a0e17',
      paper: '#121827',
    },
    error: {
      main: '#ef5350',
    },
    warning: {
      main: '#ffa726',
    },
    info: {
      main: '#4fc3f7',
    },
    success: {
      main: '#81c784',
    },
  },
});

/** Light theme variant — available but not the default */
export const lightTheme = createTheme({
  ...sharedOptions,
  palette: {
    mode: 'light',
    primary: {
      main: '#0288d1',
    },
    secondary: {
      main: '#43a047',
    },
    background: {
      default: '#f5f5f5',
      paper: '#ffffff',
    },
  },
});
