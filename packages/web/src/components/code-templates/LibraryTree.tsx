// ===========================================
// Library Tree
// ===========================================
// Collapsible list of libraries with their templates.

import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import CodeIcon from '@mui/icons-material/Code';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import type { CodeTemplateLibrary, CodeTemplateDetail } from '../../api/client.js';

interface LibraryTreeProps {
  readonly libraries: ReadonlyArray<CodeTemplateLibrary>;
  readonly templates: ReadonlyArray<CodeTemplateDetail>;
  readonly selectedTemplateId: string | null;
  readonly onSelectTemplate: (template: CodeTemplateDetail) => void;
  readonly onEditLibrary: (library: CodeTemplateLibrary) => void;
  readonly onDeleteLibrary: (library: CodeTemplateLibrary) => void;
}

export function LibraryTree({
  libraries,
  templates,
  selectedTemplateId,
  onSelectTemplate,
  onEditLibrary,
  onDeleteLibrary,
}: LibraryTreeProps): ReactNode {
  const [expandedLibraries, setExpandedLibraries] = useState<ReadonlySet<string>>(
    new Set(libraries.map((l) => l.id)),
  );

  const toggleLibrary = (id: string): void => {
    setExpandedLibraries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (libraries.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No libraries yet. Create one to get started.
        </Typography>
      </Box>
    );
  }

  return (
    <List dense disablePadding>
      {libraries.map((lib) => {
        const isExpanded = expandedLibraries.has(lib.id);
        const libTemplates = templates.filter((t) => t.libraryId === lib.id);

        return (
          <Box key={lib.id}>
            <ListItemButton
              onClick={() => { toggleLibrary(lib.id); }}
              sx={{ pr: 1 }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                {isExpanded ? <FolderOpenIcon fontSize="small" /> : <FolderIcon fontSize="small" />}
              </ListItemIcon>
              <ListItemText
                primary={lib.name}
                primaryTypographyProps={{
                  noWrap: true,
                  sx: { fontWeight: 600 },
                }}
              />
              <Tooltip title="Edit library">
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); onEditLibrary(lib); }}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete library">
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); onDeleteLibrary(lib); }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </ListItemButton>
            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
              <List dense disablePadding>
                {libTemplates.map((tmpl) => (
                  <ListItemButton
                    key={tmpl.id}
                    selected={selectedTemplateId === tmpl.id}
                    onClick={() => { onSelectTemplate(tmpl); }}
                    sx={{ pl: 4 }}
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <CodeIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary={tmpl.name}
                      primaryTypographyProps={{ noWrap: true }}
                    />
                  </ListItemButton>
                ))}
                {libTemplates.length === 0 ? (
                  <Typography variant="caption" color="text.secondary" sx={{ pl: 6, py: 1, display: 'block' }}>
                    No templates
                  </Typography>
                ) : null}
              </List>
            </Collapse>
          </Box>
        );
      })}
    </List>
  );
}
