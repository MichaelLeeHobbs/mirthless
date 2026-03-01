# 11 — Users

## Prerequisites
- Logged in as admin

## User List

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 1 | Table displays users | Navigate to Users page | Table shows all users with columns | |
| 2 | Role chips | View user rows | Role chips colored by role (admin, deployer, developer, viewer) | |
| 3 | Enabled/Disabled chip | View user with enabled=true and enabled=false | Correct status chip displayed | |
| 4 | Last login date | View user who has logged in | Last login formatted as date/time | |

## Create User

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 5 | Open create dialog | Click "Create User" button | Dialog opens with empty form fields | |
| 6 | Fill required fields | Enter username, email, password | Fields accept input | |
| 7 | Role dropdown | Click Role dropdown | All roles available (admin, deployer, developer, viewer) | |
| 8 | Submit creates user | Fill all fields, click Create | Dialog closes, new user appears in table | |
| 9 | Empty required fields | Leave username empty, submit | Validation error displayed | |
| 10 | Duplicate username | Enter existing username, submit | Error message about duplicate username | |
| 11 | Duplicate email | Enter existing email, submit | Error message about duplicate email | |

## Edit User

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 12 | Open edit dialog | Click Edit button on user row | Dialog opens with user data populated | |
| 13 | Update fields | Change first name, last name | Fields accept new values | |
| 14 | Submit saves changes | Edit fields, click Save | Dialog closes, table reflects changes | |

## Enable/Disable

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 15 | Disable user | Click disable button on enabled user | User status changes to disabled | |
| 16 | Enable user | Click enable button on disabled user | User status changes to enabled | |
| 17 | Cannot disable self | Try to disable own admin account | Action prevented (self-protection) | |

## Unlock

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 18 | Unlock visible for locked | View a locked user (failed login attempts) | Unlock button visible | |
| 19 | Click unlock | Click Unlock on locked user | Lockout reset, user can log in again | |

## Change Password

| # | Scenario | Steps | Expected | Pass? |
|---|---|---|---|---|
| 20 | Password field in edit | Open edit dialog for user | Password field available | |
| 21 | Change password | Enter new password, submit | Password updated, user can login with new password | |
